/*global QUnit*/

sap.ui.define([
	"com/lt/vacantui/controller/vacant.controller"
], function (Controller) {
	"use strict";

	QUnit.module("vacant Controller");

	QUnit.test("I should test the vacant controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
