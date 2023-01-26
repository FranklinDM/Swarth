/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(
    this,
    "PrivateBrowsingUtils",
    "resource://gre/modules/PrivateBrowsingUtils.jsm"
);

var Swarth = {
    _scopePopulated: false,
    _urls: null,

    currentScope: null,
    selectedScope: null,

    get _currentBrowser () {
        if (gBrowser) {
            return gBrowser.selectedBrowser;
        } else if (getPanelBrowser()) {
            return getPanelBrowser();
        }
        return null;
    },

    get isBrowserPrivate () {
        if (Swarth.prefs.branch.getBoolPref("keep_private_browsing_scope")) {
            return false;
        }
        return PrivateBrowsingUtils.isBrowserPrivate(Swarth._currentBrowser);
    },
    
    get currentMethod () {
        return Swarth.scm.getMethod(Swarth.currentScope, Swarth.isBrowserPrivate);
    },

    onLoad: function () {
        if (gBrowser) {
            Swarth.scm.init();
            Swarth.prefs.init();
            gBrowser.addProgressListener(Swarth.pageHandler);
            gBrowser.addEventListener("pageshow", Swarth.pageHandler.onPageShow, false);
            Swarth.observer.register();
        } else if (getPanelBrowser()) {
            getPanelBrowser().addProgressListener(Swarth.pageHandler);
        }
    },

    onUnload: function () {
        if (gBrowser) {
            gBrowser.removeProgressListener(Swarth.pageHandler);
            gBrowser.removeEventListener("pageshow", Swarth.pageHandler.onPageShow);
            Swarth.observer.unregister();
        } else if (getPanelBrowser()) {
            getPanelBrowser().removeProgressListener(Swarth.pageHandler);
        }
    },

    onScopeSelected: function (aEvent) {
        let selectedURL = aEvent.target.value;
        Swarth.selectedScope = selectedURL;
        Swarth.adjustMethodMenuItems();
    },

    onMethodSelected: function (aEvent, aMethodID) {
        let methodID = aMethodID !== undefined ?
                                     aMethodID :
                                     parseInt(aEvent.target.value);
        Swarth.scm.setMethod(Swarth.selectedScope, methodID, Swarth.isBrowserPrivate);
    },

    onPopupShowing: function (aEvent) {
        // Don't handle events for submenus
        if (aEvent.target != aEvent.currentTarget) {
            return;
        }
        let enabledMenuItem = document.getElementById("menu_swEnabled");
        enabledMenuItem.setAttribute("checked", Swarth.prefs.enabled);
        if (!Swarth._scopePopulated) {
            var scopePopup = document.getElementById("menu_swScopePopup");
            for (let i = scopePopup.childNodes.length - 1; i >= 0; i--) {
                let deadItem = scopePopup.childNodes[i];
                scopePopup.removeChild(deadItem);
            }
            let urlIndex = 0;
            Swarth._urls.forEach(function (url) {
                let menuItem = document.createElement("menuitem");
                menuItem.setAttribute("id", "menu_swScopePart" + urlIndex);
                menuItem.setAttribute("type", "radio");
                menuItem.setAttribute("name", "scope");
                menuItem.setAttribute("label", url);
                menuItem.setAttribute("value", url);
                menuItem.setAttribute("closemenu", "single");
                menuItem.setAttribute("oncommand", "Swarth.onScopeSelected(event);");
                if (Swarth.selectedScope == url) {
                    menuItem.setAttribute("checked", "true");
                }
                scopePopup.appendChild(menuItem);
                urlIndex++;
            });
            Swarth._scopePopulated = true;
            Swarth.adjustMethodMenuItems();
        }
    },

    onCommand: function (aEvent) {
        let commandElement = document.getElementById("Swarth:HandleButton");
        if (aEvent.target != commandElement) {
            return;
        }

        let toolbarAction = Swarth.prefs.toolbarAction;
        switch (toolbarAction) {
            default:
            case 0:
                Swarth.prefs.toggleEnabled();
                break;
            case 1:
                let method = Swarth.scm.getMethod(Swarth.selectedScope, Swarth.isBrowserPrivate);
                if (method == Swarth.scm.kMethodDisabled) {
                    Swarth.onMethodSelected(null, Swarth.scm.kMethodDefault);
                } else {
                    Swarth.onMethodSelected(null, Swarth.scm.kMethodDisabled);
                }
                break;
            case 3:
                Swarth.openPreferences();
                break;
            case 4:
                Swarth.openScopes();
                break;
        }
    },

    openPreferences: function () {
        openDialog(
            "chrome://swarth/content/preferences.xul",
            "_blank",
            "chrome,titlebar,centerscreen",
            window
        );
    },

    openScopes: function () {
        toOpenWindowByType(
            "Swarth:Scopes",
            "chrome://swarth/content/scopes.xul",
            "chrome,titlebar,resizable,centerscreen"
        );
    },

    adjustMethodMenuItems: function () {
        var methodID = Swarth.scm.getMethod(Swarth.selectedScope, Swarth.isBrowserPrivate);
        var menuItem = null;
        switch (methodID) {
            case Swarth.scm.kMethodDisabled:
                menuItem = document.getElementById("menu_swRetainStyle");
                break;
            case Swarth.scm.kMethodCSSProcessor:
                menuItem = document.getElementById("menu_swUseCSSProcessor");
                break;
            case Swarth.scm.kMethodCSSSimple:
                menuItem = document.getElementById("menu_swUseCSSSimple");
                break;
            case Swarth.scm.kMethodColorInversion:
                menuItem = document.getElementById("menu_swUseColorInversion");
                break;
            default:
            case Swarth.scm.kMethodDefault:
                menuItem = document.getElementById("menu_swUseDefault");
                break;
        }
        menuItem.setAttribute("checked", "true");
    },
    
    resetScope: function () {
        Swarth._scopePopulated = false;
        Swarth.currentScope = null;
        let currentURI = Swarth._currentBrowser.currentURI.cloneIgnoringRef();
        Swarth._urls = Swarth.generateHierarchy(currentURI);
        Swarth.updateCurrentScope();
        Swarth.selectedScope = Swarth.currentScope;
    },
    
    updateCurrentScope: function () {
        if (Swarth._urls == null) {
            return;
        }
        Swarth._urls.forEach(function (url) {
            let methodID = Swarth.scm.getMethod(url, Swarth.isBrowserPrivate);
            if (methodID != Swarth.scm.kMethodDefault) {
                Swarth.currentScope = url;
            }
        });
        // Use the base domain as the default scope
        if (Swarth.currentScope == null) {
            Swarth.currentScope = Swarth._urls.keys().next().value;
        }
    },

    generateHierarchy: function (aURI) {
        var urls = new Set();
        var hosts = [];
        var prePath = aURI.prePath;
        var hasAuthority = /(https|http|ftp|gopher)/i.test(aURI.scheme);
        if (hasAuthority) {
            try {
                prePath = aURI.hostPort.replace("www.", "");
                // Get the base domain with eTLD (used to check if this is an IP)
                var baseDomain = Services.eTLD.getBaseDomain(aURI);
                var hostParts = prePath.split(".");
                baseDomain = hostParts.slice(-2).join(".");
                for (let i = 0; i < hostParts.length - 2; i++) {
                    let currentHost = hostParts[i];
                    for (let j = i + 1; j < hostParts.length - 2; j++) {
                        currentHost += "." + hostParts[j];
                    }
                    currentHost += "." + baseDomain;
                    hosts.push(currentHost);
                }
                hosts.push(baseDomain);
            } catch (e) {}
        } else {
            hosts.push(prePath);
        }
        for (let i = hosts.length - 1; i >= 0; i--) {
            urls.add(hosts[i]);
        }
        var pathName = aURI
                       .filePath
                       .replace(/\/+$/, "")      // Strip trailing forward slashes
                       .replace("//", "%2F%2F"); // Escape double slash inside path names
        var pathSegments = pathName.split("/");
        for (let i = 0; i < pathSegments.length; i++) {
            var currentURL = prePath;
            if (pathSegments[i] != "") {
                for (let depth = 0; depth <= i; depth++) {
                    let currentSegment = pathSegments[depth];
                    if (depth > 0) {
                        currentURL += "/";
                    }
                    currentURL += currentSegment.replace("%2F%2F", "//");
                }
            }
            if (!urls.has(currentURL)) {
                urls.add(currentURL);
            }
        }
        return urls;
    },

    _updateDocShell: function (aDocShell, aInvalidate) {
        if (aDocShell == null) {
            aDocShell = Swarth._currentBrowser.docShell;
        }

        return Swarth.scm.updateDocShell(
            {
                docShell: aDocShell,
                method: Swarth.currentMethod,
                invalidate: aInvalidate,
            },
            Swarth.prefs.getAll()
        );
    },
};

this.Swarth.pageHandler = {
    QueryInterface: XPCOMUtils.generateQI(
        ["nsIWebProgressListener", "nsISupportsWeakReference"]
    ),

    onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus) {
        if (!aRequest) {
            return;
        }

        let domWindow = aWebProgress.DOMWindow;
        if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
            !Swarth.scm.windowState.has(domWindow)) {
            // Don't bother updating if the current page is blocked.
            if (Swarth.scm.isForceBlocked(domWindow)) {
                return;
            }
            Swarth.scm.update(
                {
                    window: domWindow,
                    method: Swarth.currentMethod,
                    isTopLevel: aWebProgress.isTopLevel
                },
                Swarth.prefs.getAll()
            );
        }
    },

    onLocationChange: function (aWebProgress, aRequest, aLocationURI, aFlags) {
        let isTopLevel = aWebProgress.isTopLevel;
        if (isTopLevel) {
            Swarth.resetScope();
        }

        if (aRequest) {
            // Don't bother updating if the current page is blocked.
            if (Swarth.scm.isForceBlocked(domWindow)) {
                return;
            }
            Swarth.scm.update(
                {
                    window: aWebProgress.DOMWindow,
                    method: Swarth.currentMethod,
                    isTopLevel: isTopLevel
                },
                Swarth.prefs.getAll()
            );
        } else {
            Swarth._updateDocShell(aWebProgress);
        }
    },

    onPageShow: function (aEvent) {
        Swarth._updateDocShell(null);
    },
};

this.Swarth.observer = {
    kObserverTopics: [
        "swm-state-changed",
        "dom-window-destroyed"
    ],

    observe: function (aSubject, aTopic, aData) {
        switch (aTopic) {
            case "swm-state-changed":
                if (aData.includes("scope-updated")) {
                    Swarth.updateCurrentScope();
                    Swarth.adjustMethodMenuItems();
                }

                Swarth._updateDocShell(
                    null,
                    (aData == "invalidate")
                );

                break;
            case "dom-window-destroyed":
                Swarth.scm.remove(aSubject, true);
                break;
        }
    },

    register: function () {
        for (let i = 0; i < this.kObserverTopics.length; i++) {
            Services.obs.addObserver(this, this.kObserverTopics[i], false);
        }
    },

    unregister: function () {
        for (let i = 0; i < this.kObserverTopics.length; i++) {
            Services.obs.removeObserver(this, this.kObserverTopics[i]);
        }
    },
};

XPCOMUtils.defineLazyModuleGetter(
    Swarth,
    "scm",
    "chrome://swarth/content/modules/ScopeManager.jsm",
    "ScopeManager"
);
XPCOMUtils.defineLazyModuleGetter(
    Swarth,
    "prefs",
    "chrome://swarth/content/modules/Preferences.jsm",
    "Preferences"
);

window.addEventListener("load", Swarth.onLoad, false);
window.addEventListener("unload", Swarth.onUnload, false);
