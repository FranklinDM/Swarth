/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("chrome://swarth/content/modules/ScopeManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(
    this,
    "JSONFile",
    "resource://gre/modules/JSONFile.jsm"
);

const kLegacyPrefs = [
    "extensions.jid1-QoFqdK4qzUfGWQ@jetpack.configured_pages",
    "extensions.AdvancedNightMode@Off.JustOff.configured_pages"
];

var gScopes = null;
var modifiedScopes = new Map();

var gScopeDialog = {
    _initialized: false,
    _tree: null,
    _siteField: null,
    _methodMenu: null,
    _bundle: null,

    _view: {
        sortdir: false,
        sortcol: -1,
        _rowCount: 0,

        get rowCount() {
            return this._rowCount;
        },

        _getMethodName: function (aMethodID) {
            let menuItem = document.getElementById("method-" + aMethodID);
            if (menuItem) {
                return menuItem.label;
            }
            return "";
        },

        getCellText : function (aRow, aColumn) {
            if (gScopes[aRow] !== undefined) {
                switch (aColumn.id) {
                    case "siteCol":
                        return gScopes[aRow][0];
                    case "methodCol":
                        let methodID = gScopes[aRow][1];
                        return this._getMethodName(methodID);
                    default:
                        break;
                }
            }
            return "";
        },

        setTree: function (aTreebox) {
            this.treebox = aTreebox;
        },

        isContainer: function (aRow) {
            return false;
        },

        isSeparator: function (aRow) {
            return false;
        },

        isSorted: function () {
            return false;
        },

        getLevel: function (aRow) {
            return 0;
        },

        getImageSrc: function (aRow, aCol) {
            return null;
        },

        cycleHeader: function (aColumn) {},
        getRowProperties: function (aRow) {},
        getCellProperties: function (aRow, aColumn) {},
        getColumnProperties: function (aColumn) {},
    },

    _sortColumn: function (aColumn, aKeepSortDirection) {
        var comparator;
        switch (aColumn.id) {
            case "siteCol":
                comparator = function textComparator(a, b) {
                    return a.toLowerCase().localeCompare(b.toLowerCase());
                };
                break;
            case "methodCol":
                comparator = function numComparator(a, b) {
                    return a - b;
                };
                break;
            default:
                break;
        }

        let sortDir = aKeepSortDirection ?
                      !this._view.sortdir :
                      this._view.sortdir;

        this._view.sortdir = gTreeUtils.sort(
            this._tree,
            this._view,
            gScopes,
            aColumn.index,
            comparator,
            this._view.sortcol,
            sortDir
        );

        this._view.sortcol = aColumn.index;
    },

    _addScope: function (aURL, aMethodID) {
        var scopeRemoved = (aMethodID == ScopeManager.kMethodDefault);
        var removedIndex = -1;

        if (scopeRemoved) {
            for (let i = 0; i < gScopes.length; i++) {
                let currentScope = gScopes[i];
                if (currentScope[0] == aURL) {
                    gScopes.splice(i, 1);
                    this._tree.treeBoxObject.rowCountChanged(i + 1, -1);
                }
            }
            this._view._rowCount--;

            modifiedScopes.delete(aURL);
        } else {
            var scope = [aURL, aMethodID];
            var scopeExists = false;

            for (let i = 0; i < gScopes.length; i++) {
                let currentURL = gScopes[i][0];
                if (currentURL == aURL) {
                    gScopes[i] = scope;
                    scopeExists = true;
                }
            }

            if (!scopeExists) {
                gScopes.push(scope);
                this._tree.treeBoxObject.rowCountChanged(this._view.rowCount - 1, 1);
                this._view._rowCount++;
            }

            modifiedScopes.set(aURL, aMethodID);
        }

        if (gScopes.length > 0) {
            let columnID = (this._view.sortcol > -1) ?
                           this._view.sortcol :
                           0;
            let column = this._tree.columns.getColumnAt(columnID);
            this._sortColumn(column, true);
        } else {
            this._tree.treeBoxObject.invalidate();
        }
    },
    
    observe: function (aSubject, aTopic, aData) {
        if (aData.includes("scope-updated")) {
            let data = aData.split(" ");
            if (data.length < 4) {
                return;
            }
            let privateContext = (data[3] == "true");
            if (privateContext) {
                return;
            }
            this._addScope(data[1], data[2]);
        }
    },

    onLoad: function () {
        if (this._initialized) {
            return;
        }

        Services.obs.addObserver(this, "swm-state-changed", false);

        this._bundle = document.getElementById("bundleScopes");
        this._siteField = document.getElementById("urlTextbox");
        this._methodMenu = document.getElementById("scopeMethodMenu");
        this._tree = document.getElementById("scopeTree");

        gScopes = Object.entries(ScopeConfig.data.scopes);
        this._view._rowCount = gScopes.length;
        this._tree.view = this._view;
        this.onRowSelected();

        this._initialized = true;
    },
    
    onUnload: function () {
        Services.obs.removeObserver(this, "swm-state-changed");
    },

    onAccept: function () {
        ScopeManager.setMethods(Array.from(modifiedScopes));
        window.close();
    },

    onHostKeyPress: function (aEvent) {
        if (aEvent.keyCode == KeyEvent.DOM_VK_RETURN) {
            document.getElementById("btnAddScope").click();
        }
    },

    onHostInput: function (aSiteField) {
        document.getElementById("addScopeBtn").disabled = !aSiteField.value;
        document.getElementById("scopeMethodMenu").disabled = !aSiteField.value;
    },

    onTreeKeyPress: function (aEvent) {
        if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
            this.onRowDeleted();
        }
    },

    onColumnSorted: function (aEvent) {
        let columnName = aEvent.target.id;
        let column = this._tree.columns.getNamedColumn(columnName);
        this._sortColumn(column, false);
    },

    onRowAdded: function () {
        var url = this._siteField.value.trim();
        var methodID = parseInt(this._methodMenu.value);
        // FIXME: Sanitize the URL
        this._addScope(url, methodID);
        this._siteField.value = "";
        this.onHostInput(this._siteField);
    },

    onRowSelected: function (aEvent) {
        let hasSelection = this._tree.view.selection.count > 0;
        let hasRows = this._tree.view.rowCount > 0;
        document.getElementById("removeRow").disabled = !hasRows || !hasSelection;
        document.getElementById("removeAllRows").disabled = !hasRows;
        if (aEvent && aEvent.target == this._tree && hasSelection && hasRows) {
            let rowIndex = this._tree.view.selection.currentIndex;
            let scope = gScopes[rowIndex];
            this._siteField.value = scope[0];
            this._methodMenu.value = scope[1];
            this.onHostInput(this._siteField);
        }
    },

    onRowDeleted: function () {
        if (!this._view.rowCount) {
            return;
        }
        var removedRows = [];
        gTreeUtils.deleteSelectedItems(this._tree, this._view, gScopes, removedRows);
        for (let i = 0; i < removedRows.length; ++i) {
            let scopeURI = removedRows[i][0];
            modifiedScopes.set(scopeURI, ScopeManager.kMethodDefault);
        }
        document.getElementById("removeRow").disabled = !gScopes.length;
        document.getElementById("removeAllRows").disabled = !gScopes.length;
    },

    onAllRowsDeleted: function () {
        if (!this._view.rowCount) {
            return;
        }
        var removedRows = [];
        gTreeUtils.deleteAll(this._tree, this._view, gScopes, removedRows);
        for (let i = 0; i < removedRows.length; ++i) {
            let scopeURI = removedRows[i][0];
            modifiedScopes.set(scopeURI, ScopeManager.kMethodDefault);
        }
        document.getElementById("removeRow").disabled = true;
        document.getElementById("removeAllRows").disabled = true;
    },

    _getFilePicker: function (aSave) {
        let mode = aSave ?
                   Ci.nsIFilePicker.modeSave :
                   Ci.nsIFilePicker.modeOpen;
        var filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        filePicker.init(window, null, mode);
        filePicker.appendFilter("JSON Files", "*.json");
        filePicker.appendFilters(Ci.nsIFilePicker.filterText);
        filePicker.appendFilters(Ci.nsIFilePicker.filterAll);
        filePicker.filterIndex = 0;
        filePicker.defaultExtension = "json";
        filePicker.defaultString = "swarth-scope.json";
        return filePicker;
    },

    _tryLoad: function (aPath) {
        var tempFile = new JSONFile({ path: aPath });
        try {
            tempFile.ensureDataReady();
        } catch (e) {
            return false;
        }
        return tempFile;
    },

    _reloadScopes: function () {
        this._tree.treeBoxObject.rowCountChanged(0, gScopes.length);
        this._view._rowCount = gScopes.length;
        this.onRowSelected();
        for (let i = 0; i < gScopes.length; ++i) {
            let scope = gScopes[i];
            modifiedScopes.set(scope[0], scope[1]);
        }
    },

    onImportLegacy: function () {
        let dialogTitle = this._bundle.getString("import.title");
        let dialogBody = this._bundle.getString("import.fromLegacy");
        let result = Services.prompt.confirm(null, dialogTitle, dialogBody);
        if (result) {
            let newScopes = {};
            for (let i = 0; i < kLegacyPrefs.length; i++) {
                let prefValue = Services.prefs.getCharPref(kLegacyPrefs[i], "{}");
                prefValue = JSON.parse(prefValue);
                newScopes = Object.assign(newScopes, prefValue);
            }
            ScopeManager.migrateConfig(newScopes);
            newScopes = Object.entries(newScopes.scopes);
            if (newScopes.length > 0) {
                this.onAllRowsDeleted();
                gScopes = newScopes;
                this._reloadScopes();
            } else {
                dialogBody = this._bundle.getString("import.empty");
                Services.prompt.alert(null, dialogTitle, dialogBody);
            }
        }
    },

    onImport: function () {
        let filePicker = this._getFilePicker(false);
        let result = filePicker.show();
        if (result != Ci.nsIFilePicker.returnCancel) {
            let srcFile = this._tryLoad(filePicker.file.path);
            if (srcFile) {
                this.onAllRowsDeleted();
                let tmpData = srcFile.data;
                ScopeManager.migrateConfig(tmpData);
                gScopes = Object.entries(tmpData.scopes);
                this._reloadScopes();
            } else {
                let dialogTitle = this._bundle.getString("import.title");
                let dialogBody = this._bundle.getString("import.failed");
                Services.prompt.alert(null, dialogTitle, dialogBody);
            }
        }
    },

    onExport: function () {
        let filePicker = this._getFilePicker(true);
        let result = filePicker.show();
        if (result != Ci.nsIFilePicker.returnCancel) {
            let destFile = this._tryLoad(filePicker.file.path);
            if (destFile) {
                destFile._data.version = ScopeManager.kConfigVersion;
                destFile._data.scopes = Object.fromEntries(gScopes);
                destFile.saveSoon();
            } else {
                let dialogTitle = this._bundle.getString("export.title");
                let dialogBody = this._bundle.getString("export.failed");
                Services.prompt.alert(null, dialogTitle, dialogBody);
            }
        }
    },
};