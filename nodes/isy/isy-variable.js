var EventEmitter = require('events');

var ISYVariable = function (controller_node, xmlVariableDef) {
    this.events = new EventEmitter.EventEmitter();
    this.controller = controller_node;
    try {
        this.type = xmlVariableDef.attr.type;
        this.name = '';
        this.var_id = xmlVariableDef.attr.id;
        this.id = this.type + '_' + this.var_id;
        this.controller.node.debug('Initializing Variable: ' + this.id.toString());
        this.parseXML(xmlVariableDef);
    } catch (err) {
        this.controller.node.warn('Error creating variable: ' + err);
    }
}

ISYVariable.prototype.parseXML = function (xmlVariableDef) {
    try {
        this.init = tryStringToNum(xmlVariableDef.childNamed('init').val);
        this.prec = tryStringToNum(xmlVariableDef.childNamed('prec').val);
        this.val = tryStringToNum(xmlVariableDef.childNamed('val').val);
    } catch (err) {
        this.controller.node.warn('Error parsing variable XML: ' + err);
    }
}

ISYVariable.prototype.updatedVal = function (xmlVariableDef) {
    try {
        this.val = tryStringToNum(xmlVariableDef.childNamed('val').val);
        this.events.emit('value_updated');
    } catch (err) {
        this.controller.node.warn('Error updating variable value: ' + err);
    }
}

ISYVariable.prototype.updatedInit = function (xmlVariableDef) {
    try {
        this.init = tryStringToNum(xmlVariableDef.childNamed('init').val);
        this.events.emit('init_updated');
    } catch (err) {
        this.controller.node.warn('Error updating variable init value: ' + err);
    }
}

ISYVariable.prototype.setValue = function (newValue) {
    try {
        ///rest/vars/set/<var-type>/<var-id>/<value>
        var url = '/rest/vars/set/' + this.type + '/' + this.var_id + '/' + newValue;
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error setting variable ' + this.id + ' value: ' + err);
    }
}

ISYVariable.prototype.setInit = function (newValue) {
    try {
        ///rest/vars/init/<var-type>/<var-id>/<value>
        var url = '/rest/vars/init/' + this.type + '/' + this.var_id + '/' + newValue;
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error setting variable init ' + this.id + ' value: ' + err);
    }
}

ISYVariable.prototype.getVal = function () {
    try {
        //there's no way to query just a single variable via REST.  We had might as well update all of the variables of this type
        this.controller.getVariables(this.type);
    } catch (err) {
        this.controller.node.warn('Error setting variable init ' + this.id + ' value: ' + err);
    }
}

function tryStringToNum(string) {
    try {
        return Number(string);
    } catch (err) {
        return string;
    }
}

exports.ISYVariable = ISYVariable;