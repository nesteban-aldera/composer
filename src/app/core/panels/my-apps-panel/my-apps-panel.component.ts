import {AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnInit, QueryList, ViewChild, ViewChildren} from "@angular/core";
import {FormControl} from "@angular/forms";

import "rxjs/add/operator/map";
import {Observable} from "rxjs/Observable";

import {LocalFileRepositoryService} from "../../../file-repository/local-file-repository.service";
import {ConnectionState} from "../../../services/storage/user-preferences-types";
import {UserPreferencesService} from "../../../services/storage/user-preferences.service";
import {ModalService} from "../../../ui/modal/modal.service";
import {TreeNode} from "../../../ui/tree-view/tree-node";
import {TreeNodeComponent} from "../../../ui/tree-view/tree-node/tree-node.component";
import {TreeViewComponent} from "../../../ui/tree-view/tree-view.component";
import {TreeViewService} from "../../../ui/tree-view/tree-view.service";
import {DirectiveBase} from "../../../util/directive-base/directive-base";
import {DataGatewayService} from "../../data-gateway/data-gateway.service";
import {FilesystemEntry, FolderListing} from "../../data-gateway/data-types/local.types";
import {PlatformAppEntry} from "../../data-gateway/data-types/platform-api.types";
import {AddSourceModalComponent} from "../../modals/add-source-modal/add-source-modal.component";
import {WorkboxService} from "../../workbox/workbox.service";
import {NavSearchResultComponent} from "../nav-search-result/nav-search-result.component";

@Component({
    selector: "ct-my-apps-panel",
    providers: [LocalFileRepositoryService],
    templateUrl: "./my-apps-panel.component.html",
    styleUrls: ["./my-apps-panel.component.scss"]
})
export class MyAppsPanelComponent extends DirectiveBase implements OnInit, AfterViewInit {

    treeNodes: TreeNode<any>[];

    searchContent = new FormControl();

    searchResults = undefined;

    appliedSearchTerm: string;

    expandedNodes: Observable<string[]>;

    @ViewChild(TreeViewComponent)
    treeView: TreeViewComponent;

    tree: TreeViewService;

    @ViewChildren(NavSearchResultComponent, {read: ElementRef})
    private searchResultComponents: QueryList<ElementRef>;

    constructor(private preferences: UserPreferencesService,
                private cdr: ChangeDetectorRef,
                private workbox: WorkboxService,
                private modal: ModalService,
                private dataGateway: DataGatewayService) {
        super();

        this.expandedNodes = this.preferences.get("expandedNodes", []).take(1).publishReplay(1).refCount();
    }

    ngOnInit(): void {

    }

    ngAfterViewInit() {
        this.tree = this.treeView.getService();

        setTimeout(() => {
            this.loadDataSources();
            this.attachSearchObserver();
            this.listenForLocalExpansion();
            this.listenForPlatformExpansion();
            this.listenForProjectExpansion();
            this.listenForFolderExpansion();
            this.attachExpansionStateSaving();
            this.listenForAppOpening();
        });


        this.searchResultComponents.changes.subscribe(list => {
            list.forEach((el, idx) => setTimeout(() => el.nativeElement.classList.add("shown"), idx * 20));
        });
    }

    private loadDataSources() {
        this.tracked = this.dataGateway.getDataSources()
            .do(data => console.log("Loading Source", data))
            .withLatestFrom(this.expandedNodes, (sources, expanded) => ({sources, expanded}))
            .subscribe((data: { sources: any[], expanded: string[] }) => {
                this.treeNodes = data.sources.map(source => {

                    let icon = "fa-folder";
                    if (source.status === ConnectionState.Disconnected) {
                        icon = "fa-chain-broken";
                    } else if (source.status === ConnectionState.Connecting) {
                        icon = "fa-bolt";
                    }


                    return {
                        id: source.hash,
                        label: source.label,
                        isExpandable: true,
                        isExpanded: data.expanded.indexOf(source.hash) !== -1,
                        iconExpanded: "fa-folder-open",
                        type: "source",
                        data: source,
                        icon: `${icon} ${source.connected ? "connected" : "disconnected"}`

                    };
                });
                this.cdr.markForCheck();
            });
    }

    private attachSearchObserver() {

        const localFileSearch = (term) => this.dataGateway.searchLocalProjects(term).map(results => results.map(result => {

            const id    = result.path;
            const label = result.path.split("/").slice(-3, -1).join("/");
            const title = result.path.split("/").pop();

            let icon      = "fa-file";
            let relevance = result.relevance;

            if (result.type === "Workflow") {
                icon = "fa-share-alt";
                relevance++;
            } else if (result.type === "CommandLineTool") {
                icon = "fa-terminal";
                relevance++;
            }

            return {
                id, icon, title, label, relevance,
                dragEnabled: ["Workflow", "CommandLineTool"].indexOf(result.type) !== -1,
                dragTransferData: id,
                dragLabel: title,
                dragImageClass: result.type === "CommandLineTool" ? "icon-command-line-tool" : "icon-workflow",
                dragDropZones: ["zone1"]
            };
        }));

        const projectsSearch = (term) => this.dataGateway.searchUserProjects(term).map(results => results.map(result => {

            const id    = result.profile + "/" + result["sbg:projectName"] + "/" + result["sbg:id"];
            const title = result.label;

            return {
                id,
                icon: result.class === "Workflow" ? "fa-share-alt" : "fa-terminal",
                title,
                label: result.id.split("/").slice(5, 7).join(" → "),
                relevance: result.relevance + 1,

                dragEnabled: true,
                dragTransferData: id,
                dragLabel: title,
                dragImageClass: result["class"] === "CommandLineTool" ? "icon-command-line-tool" : "icon-workflow",
                dragDropZones: ["zone1"]
            };
        }));

        this.searchContent.valueChanges
            .do(term => this.searchResults = undefined)
            .debounceTime(250)
            .distinctUntilChanged()
            .do(term => {
                this.appliedSearchTerm = term;
            })
            .filter(term => term.trim().length !== 0)
            .switchMap(term => Observable.forkJoin(localFileSearch(term), projectsSearch(term)))
            .subscribe(datasets => {
                const combined     = [].concat(...datasets).sort((a, b) => b.relevance - a.relevance);
                this.searchResults = combined;
                this.cdr.markForCheck();
            });
    }

    /**
     * Expansion of a source root
     */
    private listenForPlatformExpansion() {

        this.tree.expansionChanges
            .filter(node => node.isExpanded === true && node.type === "source" && node.id !== "local")
            .do(n => n.modify(() => n.loading = true))
            .flatMap(n => this.dataGateway.getPlatformListing(n.id), (node, listing = []) => ({node, listing}))
            .withLatestFrom(this.expandedNodes, (outer, expanded) => ({...outer, expanded}))
            .subscribe((data: { node: TreeNodeComponent<any>, listing: any, expanded: string[] }) => {
                const children = data.listing.map((child, index) => {
                    const id = `${data.node.id}/${child.owner}/${child.slug}`;

                    const duplicate = data.listing.slice(0, index).concat(data.listing.slice(index + 1)).find(c => c.name === child.name);
                    let label       = child.name;

                    if (duplicate) {
                        label += ` (${child.owner})`;
                    }
                    return {
                        id,
                        type: "project",
                        data: child,
                        icon: "fa-folder",
                        label,
                        isExpandable: true,
                        isExpanded: data.expanded.indexOf(id) !== -1,
                        iconExpanded: "fa-folder-open",
                    };
                });

                // Update the tree view
                data.node.modify(() => {
                    data.node.loading  = false;
                    data.node.children = children;
                });
            });
    }

    private listenForLocalExpansion() {

        this.tree.expansionChanges.filter(n => n.isExpanded === true && n.type === "source" && n.id === "local")
            .do(n => n.modify(() => n.loading = true))
            .switchMap(n => this.dataGateway.getLocalListing(), (node, listing) => ({node, listing}))
            .withLatestFrom(this.expandedNodes, (outer, expanded) => ({...outer, expanded}))
            .subscribe((data: { node: TreeNodeComponent<any>, listing: any, expanded: string[] }) => {
                const children = data.listing.map(path => {
                    return {
                        id: path,
                        type: "folder",
                        icon: "fa-folder",
                        label: path.split("/").pop(),
                        isExpandable: true,
                        isExpanded: data.expanded.indexOf(path) !== -1,
                        iconExpanded: "fa-folder-open",
                    };
                });

                // Update the tree view
                data.node.modify(() => {
                    data.node.children = children;
                    data.node.loading  = false;
                });
            });
    }

    private listenForProjectExpansion() {
        this.tree.expansionChanges.filter(n => n.isExpanded === true && n.type === "project")
            .do(n => n.modify(() => n.loading = true))
            .flatMap(n => {
                const source = n.id.substr(0, n.id.indexOf("/"));
                return this.dataGateway.getProjectListing(source, n.data.owner, n.data.slug);
            }, (node, listing) => ({node, listing}))
            .subscribe(data => {

                const children = data.listing.map(app => {
                    const id = data.node.id + "/" + app["sbg:id"];

                    return {
                        id,
                        type: "app",
                        label: app.label,
                        icon: app.class === "CommandLineTool" ? "fa-terminal" : "fa-share-alt",
                        data: app,
                        dragEnabled: true,
                        dragTransferData: id,
                        dragDropZones: ["zone1"],
                        dragLabel: app.label,
                        dragImageClass: app.class === "CommandLineTool" ? "icon-command-line-tool" : "icon-workflow",
                    } as TreeNode<PlatformAppEntry>;
                });
                data.node.modify(() => {
                    data.node.children = children;
                    data.node.loading  = false;
                });
            });
    }

    private listenForFolderExpansion() {
        this.tree.expansionChanges
            .filter(n => n.isExpanded === true && n.type === "folder")
            .do(n => n.modify(() => n.loading = true))
            .flatMap(n => this.dataGateway.getFolderListing(n.id), (node, listing) => ({node, listing}))
            .withLatestFrom(this.expandedNodes, (outer, expanded) => ({...outer, expanded}))
            .subscribe((data: {
                            node: TreeNodeComponent<FilesystemEntry>
                            listing: FolderListing,
                            expanded: string[]
                        }) => {
                const children = data.listing.map(entry => {

                    let icon = "fa-file";
                    let iconExpanded;

                    if (entry.isDir) {
                        icon         = "fa-folder";
                        iconExpanded = "fa-folder-open";
                    } else if (entry.type === "Workflow") {
                        icon = "fa-share-alt";
                    } else if (entry.type === "CommandLineTool") {
                        icon = "fa-terminal";
                    }

                    const id    = entry.path;
                    const label = entry.path.split("/").pop();

                    return {
                        id,
                        icon,
                        label,
                        data: entry,
                        iconExpanded,
                        isExpandable: entry.isDir,
                        isExpanded: entry.isDir && data.expanded.indexOf(entry.path) !== -1,
                        type: entry.isDir ? "folder" : "file",
                        dragEnabled: ["Workflow", "CommandLineTool"].indexOf(entry.type) !== -1,
                        dragTransferData: entry.path,
                        dragDropZones: ["zone1"],
                        dragLabel: label,
                        dragImageClass: entry.type === "CommandLineTool" ? "icon-command-line-tool" : "icon-workflow",
                    };
                });


                data.node.modify(() => {
                    data.node.children = children;
                    data.node.loading  = false;
                });
            });
    }

    private attachExpansionStateSaving() {
        this.tree.expansionChanges
            .flatMap(node => this.preferences.get("expandedNodes", []).take(1), (node, expanded) => ({node, expanded}))
            .subscribe(data => {
                const {node, expanded} = data;

                if (node.isExpanded && expanded.indexOf(node.id) === -1) {
                    this.preferences.put("expandedNodes", expanded.concat(node.id));
                } else if (!node.isExpanded) {
                    const idx = expanded.indexOf(node.id);
                    if (idx !== -1) {
                        expanded.splice(idx, 1);
                        this.preferences.put("expandedNodes", expanded);
                    }
                }
            });
    }

    private listenForAppOpening() {
        this.tree.open.filter(n => n.type === "app")
            .flatMap(node => this.workbox.getOrCreateFileTab(node.id))
            .subscribe(tab => this.workbox.openTab(tab));

        this.tree.open.filter(n => n.type === "file")
            .flatMap(node => this.workbox.getOrCreateFileTab(node.data.path))
            .subscribe(tab => this.workbox.openTab(tab));
    }

    openAddAppSourcesDialog() {
        this.modal.fromComponent(AddSourceModalComponent, {
            title: "Open a Project",
            backdrop: true
        });
    }

    openSearchResult(entry: { id: string }) {
        this.workbox.getOrCreateFileTab(entry.id)
            .take(1)
            .subscribe(tab => this.workbox.openTab(tab));
    }
}