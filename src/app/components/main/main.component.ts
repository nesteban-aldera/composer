/// <reference path="../../../../node_modules/typescript/lib/lib.dom.d.ts" />
/// <reference path="../../../../node_modules/typescript/lib/lib.es6.d.ts" />
import {Component, ViewContainerRef} from "@angular/core";
import {Observable} from "rxjs/Rx";
import {EventHubService} from "../../services/event-hub/event-hub.service";
import {FileRegistry} from "../../services/file-registry.service";
import {PlatformAPI} from "../../services/api/platforms/platform-api.service";
import {SBPlatformDataSourceService} from "../../sources/sbg/sb-platform.source.service";
import {SettingsService} from "../../services/settings/settings.service";
import {UrlValidator} from "../../validators/url.validator";
import {ModalService} from "../modal/modal.service";
import {ContextService} from "../../core/ui/context/context.service";
import {GuidService} from "../../services/guid.service";
import {IpcService} from "../../services/ipc.service";
import {LocalDataSourceService} from "../../sources/local/local.source.service";
import {PublicAppService} from "../../platform-providers/public-apps/public-app.service";
import {ElectronPublicAppService} from "../../platform-providers/public-apps/electron-public-app.service";
import {UserProjectsService} from "../../platform-providers/user-projects/user-projects.service";
import {ElectronUserProjectsService} from "../../platform-providers/user-projects/electron-user-projects.service";

require("./../../../assets/sass/main.scss");
require("./main.component.scss");

@Component({
    selector: "cottontail",
    template: `
        <ct-layout class="editor-container"></ct-layout>
        <div id="runnix" [class.active]="runnix | async"></div>
    `,
    providers: [
        EventHubService,
        FileRegistry,
        UrlValidator,
        PlatformAPI,
        SBPlatformDataSourceService,
        SettingsService,
        ContextService,
        // FIXME: this needs to be handled in a system-specific way
        GuidService,
        IpcService,
        LocalDataSourceService,
        {provide: PublicAppService, useClass: ElectronPublicAppService},
        {provide: UserProjectsService, useClass: ElectronUserProjectsService}
    ],
})
export class MainComponent {

    private runnix: Observable<boolean>;

    constructor(modal: ModalService, vcRef: ViewContainerRef) {
        /**
         * Hack for angular's inability to provide the vcRef to a service with DI.
         * {@link ModalService.rootViewRef}
         */
        modal.rootViewRef = vcRef;

        this.runnix = Observable.fromEvent(document, "keyup").map((e: KeyboardEvent) => e.keyCode).bufferCount(10, 1)
            .filter(seq => seq.toString() == [38, 38, 40, 40, 37, 39, 37, 39, 66, 65].toString())
            .map(seq => Observable.of(true).concat(Observable.of(false).delay(3000)))
            .concatAll();
    }
}
