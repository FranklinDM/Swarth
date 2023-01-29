/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["ScopeManager", "ScopeConfig"];

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(
    this,
    "OS",
    "resource://gre/modules/osfile.jsm"
);
XPCOMUtils.defineLazyModuleGetter(
    this,
    "JSONFile",
    "resource://gre/modules/JSONFile.jsm"
);
XPCOMUtils.defineLazyModuleGetter(
    this,
    "StylesheetColorProcessor",
    "chrome://swarth/content/modules/StylesheetProcessor.jsm",
);
XPCOMUtils.defineLazyModuleGetter(
    this,
    "ColorUtils",
    "chrome://swarth/content/modules/ColorUtils.jsm"
);
XPCOMUtils.defineLazyModuleGetter(
    ColorUtils,
    "parseCSSColor",
    "chrome://swarth/content/modules/ColorParser.jsm"
);
XPCOMUtils.defineLazyGetter(this, "ScopeConfig", function () {
    let configPath = OS.Path.join(OS.Constants.Path.profileDir, "swarth-scope.json");
    return new JSONFile({ path: configPath });
});

var ScopeConfigTemporary = {};

var updatedWindows = new WeakSet();

var ScopeManager = {
    kConfigVersion: 1,
    kMethodBrowserOverride: -2,
    kMethodDefault: -1,
    kMethodDisabled: 0,
    kMethodCSSProcessor: 1,
    kMethodCSSSimple: 2,
    kMethodColorInversion: 3,

    windowState: new WeakMap(),

    init: function () {
        ScopeManagerInternal.init();
        this.migrateConfig(ScopeConfig.data);
    },

    migrateConfig: function (aConfig) {
        let currentConfigVersion = 0;

        if (aConfig.version != null) {
            currentConfigVersion = aConfig.version;
        }

        // Reset current configuration version to 0 if scopes is null
        if (aConfig.scopes == null) {
            delete aConfig.scopes;
            currentConfigVersion = 0;
        }

        if (currentConfigVersion == this.kConfigVersion) {
            return;
        }

        // Move scope information to the "scopes" property and ensure that the
        // scope method IDs are stored as integers. This attempts to fix issues
        // caused by erroneously setting string method IDs in the scope dialog.
        if (currentConfigVersion < 1) {
            let keys = Object.keys(aConfig);
            aConfig.scopes = {};
            for (let i = 0; i < keys.length; i++) {
                let value = aConfig[keys[i]];
                aConfig.scopes[keys[i]] = parseInt(value);
                delete aConfig[keys[i]];
            }
        }

        // Update scope configuration version
        aConfig.version = this.kConfigVersion;
    },

    isForceBlocked: function (aWindow) {
        if (!aWindow || !aWindow.document) {
            return false;
        }

        if (aWindow.document.documentElement) {
            if (aWindow.document.documentElement.id == "ublock0-epicker") {
                return true;
            }
        }

        return false;
    },

    apply: function (aWindow, aMethod, aOptions, aInvalidateCache = false) {
        var invalidateCache = aInvalidateCache ||
                (this.windowState.has(aWindow) && !updatedWindows.has(aWindow));
        if (this.windowState.has(aWindow)) {
            let state = this.windowState.get(aWindow);
            let isSameDocument = (aWindow.document == state.document.get());
            if (isSameDocument && !state.markers) {
                ScopeManagerInternal._setMarkers(aWindow);
                state.markers = true;
            }
            if (isSameDocument && state.method == aMethod && !invalidateCache) {
                return false;
            } else {
                this.remove(aWindow);
            }
        }

        let processorInstance = null;
        let sheetURIs = [];
        switch (aMethod) {
            case this.kMethodBrowserOverride:
                sheetURIs = [
                    ScopeManagerInternal.getStylesheet(
                        kSheetBrowserOverrideKey, aOptions, invalidateCache)
                ];
                break;
            case this.kMethodCSSProcessor:
                aOptions.important_for_toplevel = (aWindow.top === aWindow.self) ? '!important' : '';
                sheetURIs = [
                    ScopeManagerInternal.getStylesheet(
                        kSheetBaseKey, aOptions, invalidateCache),
                    ScopeManagerInternal.getStylesheet(
                        kSheetProcessorKey, aOptions, invalidateCache)
                ];
                processorInstance = new StylesheetColorProcessor(aWindow, aOptions);
                processorInstance.load_into_window();
                break;
            case this.kMethodCSSSimple:
                sheetURIs = [
                    ScopeManagerInternal.getStylesheet(
                        kSheetBaseKey, aOptions, invalidateCache),
                    ScopeManagerInternal.getStylesheet(
                        kSheetSimpleKey, aOptions, invalidateCache)
                ];
                break;
            default:
            case this.kMethodColorInversion:
                ScopeManagerInternal._setMarkers(aWindow);
                sheetURIs = [
                    ScopeManagerInternal.getStylesheet(
                        kSheetInvertKey, aOptions, invalidateCache)
                ];
                break;
        }

        for (let i = 0; i < sheetURIs.length; i++) {
            let currentURI = sheetURIs[i];
            let windowUtils = aWindow
                              .QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDOMWindowUtils);
            windowUtils.loadSheet(currentURI, windowUtils.USER_SHEET);
        }

        this.windowState.set(
            aWindow,
            {
                method: aMethod,
                stylesheets: sheetURIs,
                processor: processorInstance,
                document: Cu.getWeakReference(aWindow.document),
            }
        );
        updatedWindows.add(aWindow);

        // XXX: uBlock Origin's element picker inserts itself to content using
        // an iframe and does not have any identifiable markers that we can
        // use by the time this function is called. To workaround that, we
        // delay checking for the element picker's ID and try to un-apply any
        // changes that we've made.
        if (aWindow.location &&
            aWindow.location.href == "about:blank") {
            aWindow.setTimeout(function () {
                if (ScopeManager.isForceBlocked(aWindow)) {
                    if (ScopeManager.windowState.has(aWindow)) {
                        ScopeManager.remove(aWindow);
                    }
                }
            }, aOptions["compatibility.ubo_epicker_check_delay"]);
        }

        return true;
    },
    
    remove: function (aWindow, aFastUnload = false) {
        if (!this.windowState.has(aWindow)) {
            return false;
        }
        
        try {
            var currentDocument = this.windowState.get(aWindow);
            let windowUtils = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                                     .getInterface(Ci.nsIDOMWindowUtils);
            let sheetURIs = currentDocument.stylesheets;
            for (let i = 0; i < sheetURIs.length; i++) {
                let currentURI = sheetURIs[i];
                windowUtils.removeSheet(currentURI, windowUtils.USER_SHEET);
            }
            if (currentDocument.processor != null) {
                currentDocument.processor.unload_from_window(aFastUnload);
            }
        } catch (e) {
        }

        this.windowState.delete(aWindow);
        updatedWindows.delete(aWindow);

        return true;
    },

    update: function (aTarget, aOptions) {
        var invalidateCache =
            ("invalidate" in aTarget) ? aTarget.invalidate : false;
        if (aTarget.method == this.kMethodDefault) {
            aTarget.method = aOptions.default_method;
        }
        if (aOptions.enabled && aOptions.color_enabled) {
            var scopeEnabled = (aTarget.method != this.kMethodDisabled);
            if (aTarget.method == this.kMethodColorInversion &&
                !aTarget.isTopLevel) {
                scopeEnabled = false;
            }
            if (scopeEnabled) {
                return this.apply(
                    aTarget.window,
                    aTarget.method,
                    aOptions,
                    invalidateCache
                );
            }
        }
        return this.remove(aTarget.window);
    },

    updateDocShell: function (aTarget, aOptions) {
        var invalidateCache =
            ("invalidate" in aTarget) ? aTarget.invalidate : false;
        var childDocShells = ScopeManagerInternal._getChildDocShells(aTarget.docShell);
        for (let i = 0; i < childDocShells.length; i++) {
            let docShell = childDocShells[i];
            this.update(
                {
                    window: docShell.DOMWindow,
                    method: aTarget.method,
                    isTopLevel: docShell.isTopLevel,
                    invalidate: invalidateCache
                },
                aOptions
            );
        }
    },

    getMethod: function (aURI, aPrivateContext) {
        if (aPrivateContext && aURI in ScopeConfigTemporary) {
            return ScopeConfigTemporary[aURI];
        }
        if (aURI in ScopeConfig.data.scopes) {
            return ScopeConfig.data.scopes[aURI];
        }
        return this.kMethodDefault;
    },

    setMethod: function (aURI, aMethod, aPrivateContext, aSuppress) {
        let targetConfig = aPrivateContext ? ScopeConfigTemporary : ScopeConfig.data.scopes;
        if (aMethod == this.kMethodDefault) {
            delete targetConfig[aURI];
        } else {
            targetConfig[aURI] = aMethod;
        }
        if (!aSuppress) {
            let data = ["scope-updated", aURI, aMethod, aPrivateContext].join(" ");
            Services.obs.notifyObservers(null, "swm-state-changed", data);
        }
    },

    setMethods: function (aScopeArray, aPrivateContext, aConsolidate) {
        for (let i = 0; i < aScopeArray.length; i++) {
            let scope = aScopeArray[i];
            this.setMethod(scope[0], scope[1], aPrivateContext, aConsolidate);
        }
        if (aConsolidate) {
            Services.obs.notifyObservers(null, "swm-state-changed", "scope-updated multiple");
        }
    },
};

Object.freeze(ScopeManager);

XPCOMUtils.defineLazyModuleGetter(
    this,
    "NetUtil",
    "resource://gre/modules/NetUtil.jsm"
);

const kSheetBaseKey            = "base";
const kSheetSimpleKey          = "simple";
const kSheetInvertKey          = "invert";
const kSheetProcessorKey       = "processor";
const kSheetBrowserOverrideKey = "browser-override";

const kBaseSheetURI = "chrome://swarth/content/stylesheets/";
const kCharset = "UTF-8";

const kMarkerClassPrefix = 'sw-';
const kSelectorClassMap = {
    'html > body > div#outerContainer > div#mainContainer > div#viewerContainer > div#viewer.pdfViewer': 'is-pdf-viewer',
    'html > head > link[href="resource://gre/res/TopLevelImageDocument.css"]': 'is-top-level-image-document',
};

const kObserverTopics = [
    "quit-application",
    "last-pb-context-exited",
    "swm-state-changed"
];

var CachedStylesheets = new Map();

var ScopeManagerInternal = {
    _initialized: false,

    init: function () {
        if (this._initialized) {
            return;
        }
        ScopeConfig.ensureDataReady();
        for (let i = 0; i < kObserverTopics.length; i++) {
            Services.obs.addObserver(this, kObserverTopics[i], false);
        }
        this._initialized = true;
    },
    
    uninit: function () {
        ScopeConfig.saveSoon();
        ScopeConfigTemporary = {};
        for (let i = 0; i < kObserverTopics.length; i++) {
            Services.obs.removeObserver(this, kObserverTopics[i]);
        }
    },

    observe: function (aSubject, aTopic, aData) {
        switch (aTopic) {
            case "quit-application":
                this.uninit();
                break;
            case "last-pb-context-exited":
                ScopeConfigTemporary = {};
                break;
            case "swm-state-changed":
                if (aData == "invalidate") {
                    updatedWindows = new WeakSet();
                    CachedStylesheets.clear();
                }
                break;
        }
    },

    _setMarkers: function (aWindow) {
        for (let selector in kSelectorClassMap) {
            if (aWindow.document.querySelector(selector)) {
                aWindow.document.documentElement.classList.toggle(
                    kMarkerClassPrefix + kSelectorClassMap[selector],
                    true
                );
            }
        }
    },

    _getChildDocShells: function (parentDocShell) {
        // Guard against cases where the parent docshell is either
        // non-existent or does not have a getDocShellEnumerator method.
        if (!parentDocShell ||
            typeof parentDocShell.getDocShellEnumerator !== "function") {
            return [];
        }
        let docShellsEnum = parentDocShell.getDocShellEnumerator(
            Ci.nsIDocShellTreeItem.typeAll,
            Ci.nsIDocShell.ENUMERATE_FORWARDS
        );
        let docShells = [];
        while (docShellsEnum.hasMoreElements()) {
            let docShell = docShellsEnum.getNext();
            docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIWebProgress);
            docShells.push(docShell);
        }
        return docShells;
    },

    _readURIToString: function (aURI) {
        let channel = NetUtil.newChannel({
            uri: NetUtil.newURI(aURI, kCharset),
            loadUsingSystemPrincipal: true
        });
        let stream = channel.open2();

        let count = stream.available();
        let data = NetUtil.readInputStreamToString(stream, count, { charset: kCharset });

        stream.close();
        
        return data;
    },

    _stripNumberSign: function (aString) {
        if (aString.indexOf && aString.indexOf('#') === 0) {
            return aString.slice(1);
        }
        return aString;
    },

    _appendLuminance: function (aOptions) {
        let backgroundLuminance = ColorUtils.relative_luminance(
                ColorUtils.parseCSSColor(aOptions.default_background_color));
        let foregroundLuminance = ColorUtils.relative_luminance(
                ColorUtils.parseCSSColor(aOptions.default_foreground_color));
        let isDarkBackground = backgroundLuminance < foregroundLuminance;
        aOptions.if_dark_background_start = isDarkBackground ? "": "/*";
        aOptions.if_dark_background_end = isDarkBackground ? "" : "*/";
        aOptions.if_light_background_start = isDarkBackground ? "/*" : "";
        aOptions.if_light_background_end = isDarkBackground ? "*/" : '';
    },

    _getEncodedStylesheetURI: function (aSheetText, aOptions) {
        if (aOptions) {
            this._appendLuminance(aOptions);
            for (let key in aOptions) {
                aSheetText = aSheetText.replace(
                    new RegExp("{" + key + "}", "g"),
                    this._stripNumberSign(aOptions[key])
                );
            }
        }

        let sheetData = "data:text/css;charset=" + kCharset + ";base64," + btoa(aSheetText);
        let sheetURI = NetUtil.newURI(sheetData, kCharset);
        return sheetURI;
    },

    getStylesheet: function (aSheetKey, aOptions, aInvalidateCache) {
        if (aInvalidateCache || !CachedStylesheets.has(aSheetKey)) {
            let sheetURI = "";
            switch (aSheetKey) {
                case kSheetInvertKey:
                    sheetURI = kBaseSheetURI + "invert.css";
                    break;
                case kSheetBaseKey:
                    sheetURI = kBaseSheetURI + "base.css";
                    break;
                case kSheetSimpleKey:
                    sheetURI = kBaseSheetURI + "simple.css";
                    break;
                case kSheetProcessorKey:
                    sheetURI = kBaseSheetURI + "stylesheet-processor.css";
                    break;
                case kSheetBrowserOverrideKey:
                    sheetURI = kBaseSheetURI + "browser-override.css";
                    break;
                default:
                    return false;
            }

            let sheetText = this._readURIToString(sheetURI);
            let sheetURIEncoded = this._getEncodedStylesheetURI(sheetText, aOptions);
            CachedStylesheets.set(aSheetKey, sheetURIEncoded);

            return sheetURIEncoded;
        }

        return CachedStylesheets.get(aSheetKey);
    },
};
