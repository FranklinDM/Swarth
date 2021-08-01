/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("chrome://swarth/content/modules/StylesheetManager.jsm");
Cu.import("chrome://swarth/content/modules/Preferences.jsm");

var gScopes = Object.entries(ScopeConfig.data);
var scopesToRemove = [];

var gPreferencesDialog = {
    _initialized: false,
    _tree: null,

    _view: {
        sortdir: false,
        sortcol: -1,
        rowCount: 0,

        _getMethodName: function (aMethodID) {
            let menuItem = document.getElementById("method-" + aMethodID);
            if (menuItem) {
                return menuItem.label;
            }
            return "";
        },

        getCellText : function (aRow, aColumn) {
            switch (aColumn.id) {
                case "siteCol":
                    return gScopes[aRow][0];
                case "methodCol":
                    let methodID = gScopes[aRow][1];
                    return this._getMethodName(methodID);
                default:
                    return "";
            }
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

    init: function () {
        if (this._initialized) {
            return;
        }

        this._tree = document.getElementById("scopeTree");
        this._view.rowCount = gScopes.length;
        this._tree.view = this._view;
        this.onRowSelected();
        
        let textboxes = document.getElementsByTagName("textbox");
        for (let i = 0; i < textboxes.length; i++) {
            let textboxElement = textboxes[i];
            this.onTextboxChanged(textboxElement);
        }
        
        this._initialized = true;
    },

    onBeforeAccept: function () {
        if (scopesToRemove.length > 0) {
            StylesheetManager.setMethod(
                scopesToRemove,
                StylesheetManager.kMethodDefault
            );
        }
    },

    onDialogResetAll: function () {
        Preferences.reset();
        this.onAllRowsDeleted();
    },

    onTreeKeyPress: function (aEvent) {
        if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
            this.onRowDeleted();
        }
    },

    onColumnSorted: function (aEvent) {
        var columnId = aEvent.target.id;
        var column = this._tree.columns.getNamedColumn(columnId);

        var comparator;
        switch (column.id) {
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

        this._view.sortdir = gTreeUtils.sort(
            this._tree,
            this._view,
            gScopes,
            column.index,
            comparator,
            this._view.sortcol,
            this._view.sortdir
        );

        this._view.sortcol = column.index;
    },

    onRowSelected: function () {
        let hasSelection = this._tree.view.selection.count > 0;
        let hasRows = this._tree.view.rowCount > 0;
        document.getElementById("removeRow").disabled = !hasRows || !hasSelection;
        document.getElementById("removeAllRows").disabled = !hasRows;
    },

    onRowDeleted: function () {
        if (!this._view.rowCount) {
            return;
        }
        var removedRows = [];
        gTreeUtils.deleteSelectedItems(this._tree, this._view, gScopes, removedRows);
        for (let i = 0; i < removedRows.length; ++i) {
            let scopeURI = removedRows[i][0];
            scopesToRemove.push(scopeURI);
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
            scopesToRemove.push(scopeURI);
        }
        document.getElementById("removeRow").disabled = true;
        document.getElementById("removeAllRows").disabled = true;
    },

    onColorChanged: function (aTarget) {
        let textboxElement = document.getElementById(aTarget.id + "Textbox");
        textboxElement.value = aTarget.value;
    },

    onTextboxChanged: function (aTarget) {
        let inputId = aTarget.id.substring(0, aTarget.id.length - 7);
        let inputElement = document.getElementById(inputId);
        // TODO: Support other color formats
        if (aTarget.value.search(new RegExp('^#[\\da-fA-F]{6}$')) !== 0) {
            let prefName = aTarget.getAttribute("preference").substring(5);
            aTarget.value = Preferences.branch.getCharPref(prefName);
        }
        inputElement.value = aTarget.value;
    },
};
