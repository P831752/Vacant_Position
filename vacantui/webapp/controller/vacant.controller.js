sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/date/UI5Date",
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/Token",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], (Controller, JSONModel, UI5Date, Fragment, Filter, FilterOperator, Token, MessageBox, MessageToast) => {
    "use strict";

    return Controller.extend("com.lt.vacantui.controller.vacant", {
        _date: {
            "date": UI5Date.getInstance()
        },

        onInit() {
            // var oModel = new JSONModel(sap.ui.require.toUrl("delimitation/model/positions.json"));
            // this.getView().setModel(oModel);

            var oModelDate = new JSONModel(this._date);
            this.getView().setModel(oModelDate, "oModelDate");

            //this.byId('idTitleCount').setText("Positions");
            this.byId('idVacancyTitle').setText("Vacant Positions");
            //this.byId('idVBox').removeStyleClass("sapUiComponent-underline-off");

            this.getICs().then(function (totalICs) {
                // totalICs is now the resolved array
                var oICModel = new sap.ui.model.json.JSONModel({ ICs: totalICs });
                this.getView().setModel(oICModel, "ICModel");
            }.bind(this)); // <-- bind 'this' so you can use this.getView()

        },

        getICs() {
            return new Promise((resolve, reject) => {
                let oModel = this.getOwnerComponent().getModel("EGModel")

                // Define exclusion filters for externalCode
                let exclusionFilters = new Filter({
                    filters: [
                        new Filter("externalCode", FilterOperator.NE, "NOT"),
                        new Filter("externalCode", FilterOperator.NE, "LTSCTDM"),
                        new Filter("externalCode", FilterOperator.NE, "LTFS"),
                        new Filter("externalCode", FilterOperator.NE, "LTCG")
                    ],
                    and: true
                })

                let oFilter = new Filter({
                    filters: [
                        new Filter("status", FilterOperator.EQ, "A"),
                        exclusionFilters
                    ],
                    and: true
                })

                oModel.read("/FOBusinessUnit", {
                    filters: [oFilter],
                    success: (oData) => {

                        let countPromises = oData.results.map((item) => {
                            let icCode = item.externalCode
                            return this.getTotalCount(icCode)
                                .then((count) => {
                                    return {
                                        icCode: icCode, icText: item.description_defaultValue, totalCount: count
                                    }
                                })
                                .catch((error) => {
                                    console.error("Error for " + icCode + ":", error)
                                    return { icCode: icCode, count: null }
                                })
                        })

                        Promise.all(countPromises).then((countResults) => {
                            console.log("All counts:", countResults)
                            resolve(countResults)
                        })
                    },

                    error: (oError) => {
                        MessageBox.error("Error fetching IC Code Text:", oError)
                        reject(oError)
                    }
                })
            })
        },

        getTotalCount(icCode) {
            let oModel = this.getOwnerComponent().getModel("EGModel")
            return new Promise((resolve, reject) => {
                oModel.read("/EmpJob/$count", {
                    urlParameters: {
                        "$filter": "businessUnit eq '" + icCode + "' and emplStatus eq '6021'"
                    },
                    success: function (oData, response) {
                        resolve(oData)
                    },
                    error: function (oError) {
                        reject(oError)
                    }
                })
            })
        },

        _doGetVacancyPositions: async function (oEvent) {
            const sIC = this.byId("idICComboBox").getSelectedKey();
            const sEG = this.byId("idEgComboBox").getSelectedKey();

            if (!sIC || !sEG) return MessageBox.warning("Please select IC and Employee Group");

            const oBusyDialog = new sap.m.BusyDialog({
                title: "Fetching Vacancy Positions",
                text: "Please wait..."
            });
            oBusyDialog.open();

            try {
                const oVacancyList = this._getVacancyList("VALV", "E");
                /*const sUrl = `/vacancy-service/GetVacancies(IC='${sIC}',EmpGroup='${sEG}')`;
                const response = await fetch(sUrl);
                const data = await response.json();*/

                const oModel = new sap.ui.model.json.JSONModel(oVacancyList.value);

                this.getView().setModel(oModel, "VanacyListModel");
                this.byId('idVacancyTitle').setText(`Vacant Positions (${data.value.length})`);
            } catch (err) {
                MessageBox.error(`Error fetching vacancies: ${err.message}`);
            } finally {
                oBusyDialog.close();
            }
        },

        _getVacancyList(ic, eg) {
            let oModel = this.getOwnerComponent().getModel("VacancyService").sServiceUrl
            $.ajax({
                url: `${oModel}GetVacancies`,
                type: "POST",
                contentType: "application/json",
                data: JSON.stringify({ IC: ic, EmpGroup: eg }),
                success: (response) => {
                    console.log("response:" + response)
                    return response
                },
                error: (err) => {
                    let errorMsg = err?.responseText || "Unknown error";
                    MessageBox.error(`_getVacancyList: ${errorMsg}`);
                }
            });
        },
        _readAllPositionCodes: async function (model, entityPath, filters, busyDialog) {
            //return new Promise((resolve, reject) => {
            let allPositionCodes = [];
            let skip = 0;
            let top = 1000;
            let hasMore = true;

            while (hasMore) {
                const output = await new Promise((resolve, reject) => {
                    model.read(entityPath, {
                        filters: filters,
                        urlParameters: {
                            "$skip": skip,
                            "$top": top
                        },
                        success: resolve,
                        error: reject
                    });
                });

                if (output && output.results.length > 0) {
                    allPositionCodes = allPositionCodes.concat(output.results);
                    skip += top;
                } else {
                    hasMore = false;
                }
            }
            return allPositionCodes;
        },

        _readAllVacancyCodes: function (model, entityPath, positionCodes, busyDialog) {
            return new Promise((resolve, reject) => {
                var oVacancyList = [];
                // Function to process chunks recursively
                model.setUseBatch(true);
                model.setDeferredGroups(["positionBatch"]);
                var chunkSize = 180;

                const processChunk = (startIndex) => {

                    if (startIndex >= positionCodes.length) {
                        console.log("All batches submitted.");
                        resolve(oVacancyList);
                        return;
                    }

                    var chunk = positionCodes.slice(startIndex, startIndex + chunkSize);
                    var aRequestMap = [];

                    chunk.forEach(position => {
                        var aFilters = [new Filter("position", FilterOperator.EQ, position.code)];
                        aRequestMap.push(position);

                        model.read(entityPath, {
                            filters: aFilters,
                            urlParameters: {
                                "fromDate": "1900-01-01",
                                "$orderby": "startDate desc"
                            },
                            groupId: "positionBatch",
                        });
                    });
                    //console.log("Submitting batch for records:" +chunk.length);

                    // Submit batch and process next chunk
                    model.submitChanges({
                        groupId: "positionBatch",
                        success: function (oResponse) {
                            console.log("Batch chunk from index ", startIndex, " successful");
                            if (oResponse.__batchResponses) {
                                oResponse.__batchResponses.forEach((resp, index) => {
                                    let position = aRequestMap[index];

                                    if (resp.data.results.length > 0) {
                                        if (resp.data.results[0].emplStatus !== "6021" && resp.data.results[0].emplStatus !== "6025") {
                                            //console.log("emplStatus Not Equal to 6021 & 6025: ", position.code);
                                            oVacancyList.push(position);
                                        }
                                    } else if (resp.data.results.length == 0) {
                                        oVacancyList.push(position);
                                    }
                                });
                            }
                            processChunk(startIndex + chunkSize); // process next chunk
                        },
                        error: function (oError) {
                            reject(oError);

                            console.error("Vacancy Batch Error: " + oError.responseText);
                            sap.m.MessageBox.error("Vacancy Batch Error: " + oError.responseText);
                        }
                    });
                }
                processChunk(0);
            });
        },

        handleSelectionFinish: function (oEvent) {
            var selectedItems = oEvent.getParameter("selectedItems");

            if (selectedItems.length > 0) {

                var oBusyDialog = new sap.m.BusyDialog({
                    title: "Fetching Position Codes",
                    text: "Please wait..."
                });
                oBusyDialog.open();

                var oSelEGFilters = [];
                oSelEGFilters.push(new sap.ui.model.Filter("effectiveStatus", sap.ui.model.FilterOperator.EQ, 'A'));

                for (var i = 0; i < selectedItems.length; i++) {
                    oSelEGFilters.push(new sap.ui.model.Filter("cust_EmployeeGroup", sap.ui.model.FilterOperator.EQ, selectedItems[i].getKey()));
                }
                //not required below filter for getting vacany list from Position
                //oSelEGFilters.push(new sap.ui.model.Filter("incumbentNav/userId", sap.ui.model.FilterOperator.EQ, null));     

                var allPositionCodes = [];
                var iSkip = 0;
                var iPageSize = 1000;
                var that = this

                var oModel = this.getOwnerComponent().getModel("EGModel");//define wihtout empty model name in Manifest
                var oJSONModel = new JSONModel();

                function fetchData() {
                    oModel.read("/Position", {
                        filters: oSelEGFilters,
                        urlParameters: {
                            "$top": iPageSize,
                            "$skip": iSkip
                        },
                        success: function (resp) {
                            //console.log("resp=:"+resp.results.length); 
                            allPositionCodes = allPositionCodes.concat(resp.results);

                            if (resp.results.length === iPageSize) {
                                iSkip += iPageSize;
                                fetchData(); // Fetch next page
                            } else {
                                oBusyDialog.close();
                                console.log("PositionCodes length:" + allPositionCodes.length);
                                console.log("PositionCodes:" + allPositionCodes);
                                //var getVacanyList = that._doGetVacancyList(allPositionCodes);
                                //oJSONModel.setData(getVacanyList);
                                oJSONModel.setData(allPositionCodes);
                                oJSONModel.setSizeLimit(1000000);
                                that.getView().setModel(oJSONModel, "PositionsCodeModel");
                                that.byId('idTitleCount').setText("Positions (" + allPositionCodes.length + ")");
                            }
                        }.bind(this),
                        error: function (err) {
                            oBusyDialog.close();
                            console.error("Error fetching Postion data", err);
                        }
                    });
                }
                fetchData();

            } else {
                let oJSONModel = new JSONModel();
                this.getView().setModel(oJSONModel, "PositionsCodeModel");
            }
        },

        _doGetVacancyCodesBatch: async function () {
            var that = this;
            var oTable = that.byId("idPositionTable");
            var oPositionsCodeModel = that.getView().getModel("PositionsCodeModel");
            var oJSONModel = new JSONModel();

            if (oPositionsCodeModel !== undefined && oPositionsCodeModel.oData.length > 0) {

                var oBusyDialog = new sap.m.BusyDialog({
                    title: "Fetching Vacancy Codes",
                    text: "Please wait..."
                });
                oBusyDialog.open();

                var finalVancyList = await that._doGetVacancyListBatch(oPositionsCodeModel.oData, oBusyDialog);
                // Function to process chunks recursively

                oJSONModel.setData(finalVancyList);
                oJSONModel.setSizeLimit(1000000);
                that.getView().setModel(oJSONModel, "VanacyListModel");
                that.byId('idVacancyTitle').setText("Vacant Positions (" + finalVancyList.length + ")");

                oBusyDialog.close();

            } else {
                MessageBox.warning("Position table should not be Empty");
            }
        },

        _doGetVacancyCodes: async function () {

            var that = this,
                oTable = that.byId("idPositionTable");
            var oPositionsCodeModel = that.getView().getModel("PositionsCodeModel");
            var oJSONModel = new JSONModel();

            var oVacancyList = [];
            if (oPositionsCodeModel !== undefined && oPositionsCodeModel.oData.length > 0) {

                var oBusyDialog = new sap.m.BusyDialog({
                    title: "Fetching Vacancy Codes",
                    text: "Please wait..."
                });
                oBusyDialog.open();

                for (const position of oPositionsCodeModel.oData) {
                    //Ajax Call
                    //var oVacancy = await that._doGetVacancyList(position, oBusyDialog); // working as expected
                    //oData Read Call
                    var oVacancy = await that._doGetVacancyListoDataRead(position, oBusyDialog); // working as expected
                    console.log("oVacancy:" + oVacancy.code);
                    if (oVacancy.length == undefined)
                        oVacancyList.push(oVacancy)
                }

                oJSONModel.setData(oVacancyList);
                oJSONModel.setSizeLimit(1000000);
                this.getView().setModel(oJSONModel, "VanacyListModel");
                this.byId('idVacancyTitle').setText("Vacant Positions (" + oVacancyList.length + ")");

                oBusyDialog.close();
            } else {
                MessageBox.warning("Position table should not be Empty");
            }
        },

        // Working as expected.
        _doGetVacancyListoDataRead: function (position, oBusyDialog) {
            return new Promise((resolve, reject) => {
                var aFilters = [];
                var oModel = this.getOwnerComponent().getModel("EGModel");

                //var posturl = sBaseUrl + "/EmpJob?$filter=position eq '"+position.code+"' &fromDate=1900-01-01&$orderby=startDate desc";
                aFilters.push(new sap.ui.model.Filter("position", sap.ui.model.FilterOperator.EQ, position.code));
                /*aFilters.push(new sap.ui.model.Filter("fromDate", sap.ui.model.FilterOperator.EQ, "1900-01-01"));
                //aFilters.push(new sap.ui.model.Filter("$orderby", sap.ui.model.FilterOperator.EQ, "startDate desc"));
    
                var aSorters = [];
                aSorters.push(new sap.ui.model.Sorter("startDate", true)); */

                oModel.read("/EmpJob", {
                    filters: aFilters,
                    urlParameters: {
                        "fromDate": "1900-01-01",
                        "$orderby": "startDate desc"
                    },
                    success: function (data) {
                        console.log("data:" + data);
                        if (data.results.length > 0) {
                            if (data.results[0].emplStatus !== "6021" && data.results[0].emplStatus !== "6025") {
                                resolve(position);
                                console.log("Stauts not Equal to 6021");
                            } else {
                                resolve([]);
                            }
                        } else if (data.results.length == 0) {
                            resolve(position);
                        }
                    }.bind(this),
                    error: function (err) {
                        console.error("Error fetching data", err);
                        reject(error);
                    }
                });
            });
        },

        _doGetVacancyList: function (position, oBusyDialog) {
            return new Promise((resolve, reject) => {
                //var oVacancyList=[];
                var oComponent = this.getOwnerComponent(),
                    sBaseUrl = oComponent.getManifestEntry("sap.app").dataSources.mainService.uri;
                var posturl = sBaseUrl + "EmpJob?$filter=position eq '" + position.code + "' &fromDate=1900-01-01&$orderby=startDate desc";

                $.ajax({
                    url: posturl,
                    type: "GET",
                    contentType: "application/json",
                    dataType: "json",
                    success: function (data) {
                        console.log("_doGetVacancyList Success:" + data);
                        //resolve(data);
                        if (data.d.results.length > 0) {
                            if (data.d.results[0].emplStatus !== "6021" && data.d.results[0].emplStatus !== "6025") {
                                //oVacancyList.push(position);
                                resolve(position);
                                console.log("Stauts not Equal to 6021");
                            } else {
                                resolve([]);
                            }
                        } else if (data.d.results.length == 0) {
                            //oVacancyList.push(position);   
                            resolve(position);
                        }

                    },
                    error: function (error) {
                        console.log("Error:", error);
                        console.log("doGetVacancyList Error:", error.responseText);
                        oBusyDialog.close();
                        reject(error);
                    }
                });
            });
        },

        _doGetVacancyListBatch: function (positions, oBusyDialog) {
            return new Promise((resolve, reject) => {
                var oVacancyList = [];
                // Function to process chunks recursively
                var oModel = this.getOwnerComponent().getModel("EGModel");
                oModel.setUseBatch(true);
                oModel.setDeferredGroups(["positionBatch"]);
                var chunkSize = 100;

                const processChunk = (startIndex) => {

                    if (startIndex >= positions.length) {
                        console.log("All batches submitted.");
                        resolve(oVacancyList);
                        return;
                    }

                    var chunk = positions.slice(startIndex, startIndex + chunkSize);
                    var aRequestMap = [];

                    chunk.forEach(position => {
                        var aFilters = [new Filter("position", FilterOperator.EQ, position.code)];
                        aRequestMap.push(position);

                        oModel.read("/EmpJob", {
                            filters: aFilters,
                            urlParameters: {
                                "fromDate": "1900-01-01",
                                "$orderby": "startDate desc"
                            },
                            groupId: "positionBatch",
                        });
                    });
                    console.log("Submitting batch for records:" + startIndex);

                    // Submit batch and process next chunk
                    oModel.submitChanges({
                        groupId: "positionBatch",
                        success: function (oResponse) {
                            console.log("Batch chunk from index ", startIndex, " successful");
                            if (oResponse.__batchResponses) {
                                oResponse.__batchResponses.forEach((resp, index) => {
                                    let position = aRequestMap[index];

                                    if (resp.data.results.length > 0) {
                                        if (resp.data.results[0].emplStatus !== "6021" && resp.data.results[0].emplStatus !== "6025") {
                                            console.log("emplStatus Not Equal to 6021 & 6025: ", position.code);
                                            oVacancyList.push(position);
                                        }
                                    } else if (resp.data.results.length == 0) {
                                        oVacancyList.push(position);
                                    }
                                });
                            }
                            processChunk(startIndex + chunkSize); // process next chunk
                        },
                        error: function (oError) {
                            reject(error);
                            console.error("Batch error at index", startIndex, oError);
                            processChunk(startIndex + chunkSize); // continue next chunk even if one fails
                        }
                    });
                }
                processChunk(0);
            });
        },

        doDeactivePosition: async function (oEvent) {

            var oTable = this.byId("idVacancyTable"),
                oSelectedItems = oTable.getSelectedItems();
            console.log("Selected Position Codes length:" + oSelectedItems.length);

            if (oSelectedItems.length == 1) {
                var that = this,
                    oSelectedPosition = oSelectedItems[0].getCells()[0].getText(),
                    //oSelectedPosition = "80110794",//61000230
                    confirmMsg = "Are you sure you want Deactivate the Position - " + oSelectedPosition;

                const confirmDeactivate = await that._showConfirmDialog(confirmMsg, oBusyDialog);

                if (confirmDeactivate) {

                    var that = this;
                    var oEffectiveStartDate = that.byId("idDate").getDateValue();
                    oEffectiveStartDate = oEffectiveStartDate.toISOString();//2025-07-01T05:41:40.096Z 

                    //convert to /Date(-1412314200000) format
                    let dateStr = oEffectiveStartDate.slice(0, 10);//"25-12-2023";
                    let parts = dateStr.split("-");
                    let day = parseInt(parts[2], 10);
                    let month = parseInt(parts[1], 10) - 1;
                    let year = parseInt(parts[0], 10);

                    let date = new Date(year, month, day);//console.log(date);                
                    let timestamp = date.getTime();//console.log(timestamp);                
                    let jsonDate = "/Date(" + timestamp + ")/";
                    console.log("jsonDate:" + jsonDate);

                    var oBusyDialog = new sap.m.BusyDialog({
                        title: "Position Deactivation Starts",
                        text: "Please wait..."
                    });
                    oBusyDialog.open();

                    //get List of Reportees based on Selected Position
                    var oListReportees = await that._getReportees(oSelectedPosition, oBusyDialog);
                    console.log("oListReportees Size:" + oListReportees.d.results.length);

                    if (oListReportees.d.results.length > 0) {

                        // fetching selected Position Manager (IsPosition)
                        var oGetIsPosition = await that._getIsPosition(oSelectedPosition, oBusyDialog),
                            oGetIsPosition = oGetIsPosition.d.results[0].parentPosition.code;
                        console.log("oGetIsPosition:" + oGetIsPosition);

                        let oConfirmMsg = "Selected position having below " + oListReportees.d.results.length + " Reportees.\n\n";

                        for (const Reportee of oListReportees.d.results) {
                            oConfirmMsg = oConfirmMsg + Reportee.code + "\n";
                        }

                        oConfirmMsg = oConfirmMsg + "\nPlease confirm do you want to change the current position manager " + oGetIsPosition + " to above Reportees?\n\n";
                        oConfirmMsg = oConfirmMsg + "If we select Yes, First system will Change the Reportees Manager and later will De-Activate the Position";
                        oConfirmMsg = oConfirmMsg + "\n\nIf De-Activation failed, system will revert the Reportees Manager to previous Manager.";

                        const confirmed = await that._showConfirmDialog(oConfirmMsg, oBusyDialog);
                        if (confirmed) {

                            if (oGetIsPosition != null) {
                                var oUpdatePositionList = "";

                                // *** 1st Action - Changing the Reportees Manager ***
                                for (const Reportee of oListReportees.d.results) {
                                    //oConfirmMsg = oConfirmMsg + Reportee.code+"\n";                                  
                                    var oUpdatePosition = await that._updateIsPosition(Reportee.code, oGetIsPosition, oEffectiveStartDate, jsonDate, oBusyDialog, "U");
                                    oUpdatePositionList = oUpdatePositionList + oBusyDialog.getText() + "\n";
                                }
                                // *** 2nd Action - DeActivating selected Position ***
                                var oDeActivatePosition = await that._doDeactivate(oSelectedPosition, oEffectiveStartDate, oBusyDialog);
                                console.log("oDeActivatePosition Status:" + oDeActivatePosition.d[0].message);

                                if (oDeActivatePosition.d[0].status == "OK") {
                                    //oBusyDialog.setText("Successfully Deactivate the Position - "+oSelectedPosition);
                                    var oMsg = "Successfully Deactivate the Position - " + oSelectedPosition;
                                    oUpdatePositionList = oUpdatePositionList + "\n\n" + oMsg;

                                    //Display the entire results
                                    MessageBox.information(oUpdatePositionList);

                                } else {
                                    var oUpdatePositionLists = "";
                                    oUpdatePositionLists = oUpdatePositionLists + "Selected Position " + oSelectedPosition + " Deactivation Failed.\n" + oDeActivatePosition.d[0].message + "\n\n";
                                    //MessageBox.error("Selected Position <b>"+oSelectedPosition+" </b>Deactivation Failed.\n" +oDeActivatePosition.d[0].message);

                                    // *** Revoke the 1st Action, change back to Manager - 3rd Action ***
                                    for (const Reportee of oListReportees.d.results) {
                                        var oUpdatePosition = await that._updateIsPosition(Reportee.code, oSelectedPosition, oEffectiveStartDate, jsonDate, oBusyDialog, "R");
                                        oUpdatePositionLists = oUpdatePositionLists + oBusyDialog.getText() + "\n";
                                    }
                                    MessageBox.error(oUpdatePositionLists);
                                }

                                /* // *** De-Activating selected Position - 1st Action ***
                                var oDeActivatePosition = await that._doDeactivate(oSelectedPosition, oEffectiveStartDate, oBusyDialog); 
                                console.log("oDeActivatePosition Status:" +oDeActivatePosition.d[0].message);
    
                                if (oDeActivatePosition.d[0].status == "OK"){
                                    //oBusyDialog.setText("Successfully Deactivate the Position - "+oSelectedPosition);
                                    var oMsg = "Successfully Deactivate the Position - "+oSelectedPosition;
                                    oUpdatePositionList = oUpdatePositionList + oMsg +"\n\n";
                                    
                                    // *** Changing the Reportees Manager - 2nd Action ***
                                    for (const Reportee of oListReportees.d.results) {
                                        //oConfirmMsg = oConfirmMsg + Reportee.code+"\n";                                  
                                        var oUpdatePosition = await that._updateIsPosition(Reportee.code, oGetIsPosition, oEffectiveStartDate, jsonDate, oBusyDialog);                                            
                                        oUpdatePositionList = oUpdatePositionList + oBusyDialog.getText()+"\n";
                                    }
    
                                    //Display the entire results
                                    MessageBox.information(oUpdatePositionList);
    
                                } else {
                                    MessageBox.error("Position "+oSelectedPosition+" Deactivation Failed.\n" +oDeActivatePosition.d[0].message);
                                } */
                            } else {
                                MessageBox.warning("Selected Position Manager should not be empty.");
                            }
                        } else {
                            console.log("User canceled the confirmation");
                        }
                    } else {
                        // selected position does not have the Reportees
                        var oDeActivatePosition = await that._doDeactivate(oSelectedPosition, oEffectiveStartDate, oBusyDialog);
                        console.log("oDeActivatePosition Status:" + oDeActivatePosition.d[0].message);

                        if (oDeActivatePosition.d[0].status == "OK") {
                            MessageBox.success("Successfully Deactivate the Position - " + oSelectedPosition);
                        } else {
                            MessageBox.error("Position " + oSelectedPosition + " Deactivation Failed.\n" + oDeActivatePosition.d[0].message);
                        }
                    }
                }
            } else {
                if (oSelectedItems.length == 0)
                    MessageBox.warning("Please select the Position Code");
                else
                    MessageBox.warning("Please select only one Position Code");
                return;
            }

            oBusyDialog.close();
        },

        _showConfirmDialog: function (sMessage, oBusyDialog) {
            return new Promise((resolve) => {
                MessageBox.confirm(sMessage, {
                    title: "Confirmation...",
                    actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                    emphasizedAction: MessageBox.Action.YES,
                    onClose: function (oAction) {
                        resolve(oAction === MessageBox.Action.YES);
                    }
                });
            });
        },

        _updateIsPosition: function (ReporteeCode, IsPosition, EffectiveStartDate, jsonDate, oBusyDialog, status) {
            return new Promise((resolve, reject) => {

                var oComponent = this.getOwnerComponent(),
                    sBaseUrl = oComponent.getManifestEntry("sap.app").dataSources.mainService.uri,
                    posturl = sBaseUrl + "/upsert";

                var oPositionData = {};
                //"uri": "Position(code='61000230',effectiveStartDate=datetime'2025-06-20T00:00:00')",
                oPositionData.__metadata = {
                    "uri": "Position(code='" + ReporteeCode + "',effectiveStartDate=datetime'" + EffectiveStartDate + "')",
                    "type": "SFOData.Position"
                };
                oPositionData.comment = "Manager changed due to Deactivate the Previous Manager";
                oPositionData.parentPosition = {
                    "results": [
                        {
                            "code": IsPosition,
                            "effectiveStartDate": jsonDate
                        }
                    ]
                };

                $.ajax({
                    url: posturl,
                    type: "POST",
                    async: false,
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    },
                    data: JSON.stringify(oPositionData),

                    success: function (response) {
                        console.log(" updateIsPosition Success:" + status + ":" + ReporteeCode + ":" + response.d[0].status);
                        resolve(response);
                        if (response.d[0].status == "OK") {
                            //MessageBox.success("Successfully Update the Manager");
                            //result = "Update Success for the Position: "+ReporteeCode;
                            if (status == "U")
                                oBusyDialog.setText("Manager successfully updated the Reportee Position: " + ReporteeCode);
                            else
                                oBusyDialog.setText("Manager revert back the Reportee Position: " + ReporteeCode);
                        } else {
                            //MessageBox.error("Update Manager Error: " +response.d[0].message);
                            oBusyDialog.setText("Update Manager failed for the Position: " + ReporteeCode + "\n" + response.d[0].message);
                            //result = "Update Error for the Position: "+ReporteeCode;
                            //oBusyDialog.close();
                        }
                    },
                    error: function (error) {
                        console.log("updateIsPosition Error:", error);
                        console.log("updateIsPosition Response Text:", error.responseText);
                        MessageBox.error("Error to assign Selected Position Manager to Reportess:" + error.responseText);
                        oBusyDialog.close();
                        reject(error);
                    }
                });
            });
        },

        _doDeactivate: function (oSelectedPosition, oEffectiveStartDate, oBusyDialog) {
            return new Promise((resolve, reject) => {

                var oComponent = this.getOwnerComponent(),
                    sBaseUrl = oComponent.getManifestEntry("sap.app").dataSources.mainService.uri,
                    posturl = sBaseUrl + "/upsert";

                var oPositionData = {};
                //"uri": "Position(code='61000230',effectiveStartDate=datetime'2025-06-20T00:00:00')",
                oPositionData.__metadata = {
                    "uri": "Position(code='" + oSelectedPosition + "',effectiveStartDate=datetime'" + oEffectiveStartDate + "')",
                    "type": "SFOData.Position"
                };
                oPositionData.effectiveStatus = "I";

                $.ajax({
                    url: posturl,
                    type: "POST",
                    //async: false, 
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    },
                    data: JSON.stringify(oPositionData),

                    success: function (response) {
                        resolve(response);
                        console.log("doDeactivate Success:" + response);
                        /*if (response.d[0].status == "OK"){
                            MessageBox.success("Successfully Deactivate the Position");
                        } else {
                            MessageBox.error("Deactivate Update Issue: " +response.d[0].message);
                        }
                        oBusyDialog.close(); */
                    },
                    error: function (error) {
                        console.log("doDeactivate Error:", error);
                        console.log("doDeactivate Response Text:", error.responseText);
                        MessageBox.error("Deactivate Error: " + error.responseText);
                        oBusyDialog.close();
                        reject(error);
                    }
                });
            });
        },

        _getReportees: function (oSelectedPosition, oBusyDialog) {
            return new Promise((resolve, reject) => {

                var oComponent = this.getOwnerComponent(),
                    sBaseUrl = oComponent.getManifestEntry("sap.app").dataSources.mainService.uri,
                    posturl = sBaseUrl + "/Position?$filter=parentPosition/code eq '" + oSelectedPosition + "' and effectiveStatus eq 'A'";

                $.ajax({
                    url: posturl,
                    type: "GET",
                    contentType: "application/json",
                    dataType: "json",
                    //async: false,               
                    success: function (data) {
                        resolve(data);
                        console.log("getReportees Size:" + data.d.results.length);
                        // if (response.d[0].status == "OK"){
                        //     MessageBox.success("Successfully Deactivate the Position");
                        // } else {
                        //     MessageBox.error("Update Error: " +response.d[0].message);
                        // }
                        // oBusyDialog.close();
                    },
                    error: function (error) {
                        console.log("getReportees Error:", error);
                        console.log("getReportees ErrorText:", error.responseText);
                        MessageBox.error("getReportees Error:" + error.responseText);
                        oBusyDialog.close();
                        reject(error);
                    }
                });
            });
        },

        _getIsPosition: function (oSelectedPosition, oBusyDialog) {
            return new Promise((resolve, reject) => {

                var oComponent = this.getOwnerComponent(),
                    sBaseUrl = oComponent.getManifestEntry("sap.app").dataSources.mainService.uri,
                    query = "/Position?$select=code,effectiveStartDate,parentPosition/code&$expand=parentPosition&$filter=effectiveStatus eq 'A' and code eq '" + oSelectedPosition + "'",
                    getURL = sBaseUrl + query;

                $.ajax({
                    url: getURL,
                    type: "GET",
                    contentType: "application/json",
                    dataType: "json",
                    //async: false,                 
                    success: function (data) {
                        resolve(data);
                        console.log("getIsPosition Length:" + data.d.results.length);
                        //oIsPosition = data.d.results[0].parentPosition.code;
                    },
                    error: function (error) {
                        console.log("getIsPosition Error:", error);
                        console.log("getIsPosition Error Msg:", error.responseText);
                        MessageBox.error("Error to get the Manager of Selected Position:" + error.responseText);
                        oBusyDialog.close();
                        reject(error);
                    }
                });
            });
        },

        handleValueHelp: function (oEvent) {

            var sInputValue = oEvent.getSource().getValue(),
                oView = this.getView();

            // create value help dialog
            if (!this._pValueHelpDialog) {
                this._pValueHelpDialog = Fragment.load({
                    id: oView.getId(),
                    name: "delimitation.view.Dialog",
                    controller: this
                }).then(function (oValueHelpDialog) {
                    oView.addDependent(oValueHelpDialog);
                    return oValueHelpDialog;
                });
            }

            this._pValueHelpDialog.then(function (oValueHelpDialog) {
                // create a filter for the binding
                oValueHelpDialog.getBinding("items").filter([new Filter(
                    "code",
                    FilterOperator.Contains,
                    sInputValue
                )]);
                // open value help dialog filtered by the input value
                oValueHelpDialog.open(sInputValue);
            });
        },
        // handleValueHelp1: function (oEvent) { 
        // }
        _handleValueHelpSearch: function (evt) {
            var sValue = evt.getParameter("value");
            var oFilter = new Filter(
                "code",
                FilterOperator.Contains,
                sValue
            );
            evt.getSource().getBinding("items").filter([oFilter]);
        },

        // working properly for one field
        /*    onSearch: function (oEvent) {
                var oTableSearchState = [],
                    //sQuery = oEvent.getParameter("query"),
                    sQuery = oEvent.getSource().getValue(),
                    searchCodeDes="code externalName_defaultValue";
        
                if (sQuery && sQuery.length > 0) {
                    oTableSearchState = [new Filter("code", FilterOperator.Contains, sQuery),];
                }
        
                this.getView().byId("idPositionTable").getBinding("items").filter(oTableSearchState, "Application");
            }, */

        // working properly for one or more fields
        onSearch: function (oEvent) {
            var sQuery = oEvent.getSource().getValue();

            if (sQuery && sQuery.length > 0) {
                var aFilters = [
                    new Filter("code", FilterOperator.Contains, sQuery),
                    new Filter("externalName_defaultValue", FilterOperator.Contains, sQuery)
                ];
            }

            var oCombined = new Filter(aFilters, false);
            this.getView().byId("idPositionTable").getBinding("items").filter([oCombined], "Application");
        },

        _handleValueHelpClose: function (evt) {
            var aSelectedItems = evt.getParameter("selectedItems"),
                oMultiInput = this.byId("multiInput");

            if (aSelectedItems && aSelectedItems.length > 0) {
                aSelectedItems.forEach(function (oItem) {
                    oMultiInput.addToken(new Token({
                        //text: oItem.Text()
                    }));
                });
            }
        }
    });
});