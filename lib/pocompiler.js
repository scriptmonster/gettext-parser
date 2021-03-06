'use strict';

var Buffer = require('safe-buffer').Buffer;
var encoding = require('encoding');
var sharedFuncs = require('./shared');

/**
 * Comparator function for comparing msgid
 * @param {Object} object with msgid prev
 * @param {Object} object with msgid next
 * @returns {number} comparator index
 */
function compare (r1, r2) {
  if (r1.msgid > r2.msgid) {
    return 1;
  }
  if (r2.msgid > r1.msgid) {
    return -1;
  }
  return 0;
}
/**
 * Exposes general compiler function. Takes a translation
 * object as a parameter and returns PO object
 *
 * @param {Object} table Translation object
 * @return {Buffer} Compiled PO object
 */
module.exports = function (table, options) {
  var compiler = new Compiler(table, options);
  return compiler.compile();
};

/**
 * Creates a PO compiler object.
 *
 * @constructor
 * @param {Object} table Translation table to be compiled
 */
function Compiler (table, options) {
  this._table = table || {};
  this._table.headers = this._table.headers || {};
  this._table.translations = this._table.translations || {};
  this._options = options || {};
  if (!('foldLength' in this._options)) {
    this._options.foldLength = 76;
  }
  if (!('sort' in this._options)) {
    this._options.sort = false;
  }
  this._translations = [];
  this._handleCharset();
}

/**
 * Converts a comments object to a comment string. The comment object is
 * in the form of {translator:'', reference: '', extracted: '', flag: '', previous:''}
 *
 * @param {Object} comments A comments object
 * @return {String} A comment string for the PO file
 */
Compiler.prototype._drawComments = function (comments) {
  var lines = [];
  var types = [{
    key: 'translator',
    prefix: '# '
  }, {
    key: 'reference',
    prefix: '#: '
  }, {
    key: 'extracted',
    prefix: '#. '
  }, {
    key: 'flag',
    prefix: '#, '
  }, {
    key: 'previous',
    prefix: '#| '
  }];

  types.forEach(function (type) {
    if (!comments[type.key]) {
      return;
    }
    comments[type.key].split(/\r?\n|\r/).forEach(function (line) {
      lines.push(type.prefix + line);
    });
  });

  return lines.join('\n');
};

/**
 * Builds a PO string for a single translation object
 *
 * @param {Object} block Translation object
 * @param {Object} [override] Properties of this object will override `block` properties
 * @return {String} Translation string for a single object
 */
Compiler.prototype._drawBlock = function (block, override) {
  override = override || {};

  var response = [];
  var comments = override.comments || block.comments;
  var msgctxt = override.msgctxt || block.msgctxt;
  var msgid = override.msgid || block.msgid;
  var msgidPlural = override.msgid_plural || block.msgid_plural;
  var msgstr = [].concat(override.msgstr || block.msgstr);

  // add comments
  if (comments && (comments = this._drawComments(comments))) {
    response.push(comments);
  }

  if (msgctxt) {
    response.push(this._addPOString('msgctxt', msgctxt));
  }

  response.push(this._addPOString('msgid', msgid || ''));

  if (msgidPlural) {
    response.push(this._addPOString('msgid_plural', msgidPlural));
    msgstr.forEach(function (msgstr, i) {
      response.push(this._addPOString('msgstr[' + i + ']', msgstr || ''));
    }.bind(this));
  } else {
    response.push(this._addPOString('msgstr', msgstr[0] || ''));
  }

  return response.join('\n');
};

/**
 * Escapes and joins a key and a value for the PO string
 *
 * @param {String} key Key name
 * @param {String} value Key value
 * @return {String} Joined and escaped key-value pair
 */
Compiler.prototype._addPOString = function (key, value) {
  key = (key || '').toString();

  // escape newlines and quotes
  value = (value || '').toString()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

  var lines = [value];

  if (this._options.foldLength > 0) {
    lines = sharedFuncs.foldLine(value, this._options.foldLength);
  }

  if (lines.length < 2) {
    return key + ' "' + (lines.shift() || '') + '"';
  } else {
    return key + ' ""\n"' + lines.join('"\n"') + '"';
  }
};

/**
 * Handles header values, replaces or adds (if needed) a charset property
 */
Compiler.prototype._handleCharset = function () {
  var parts = (this._table.headers['content-type'] || 'text/plain').split(';');
  var contentType = parts.shift();
  var charset = sharedFuncs.formatCharset(this._table.charset);
  var params = [];

  params = parts.map(function (part) {
    var parts = part.split('=');
    var key = parts.shift().trim();
    var value = parts.join('=');

    if (key.toLowerCase() === 'charset') {
      if (!charset) {
        charset = sharedFuncs.formatCharset(value.trim() || 'utf-8');
      }
      return 'charset=' + charset;
    }

    return part;
  });

  if (!charset) {
    charset = this._table.charset || 'utf-8';
    params.push('charset=' + charset);
  }

  this._table.charset = charset;
  this._table.headers['content-type'] = contentType + '; ' + params.join('; ');

  this._charset = charset;
};

/**
 * Compiles translation object into a PO object
 *
 * @return {Buffer} Compiled PO object
 */
Compiler.prototype.compile = function () {
  var response = [];
  var headerBlock = (this._table.translations[''] && this._table.translations['']['']) || {};

  Object.keys(this._table.translations).forEach(function (msgctxt) {
    if (typeof this._table.translations[msgctxt] !== 'object') {
      return;
    }
    Object.keys(this._table.translations[msgctxt]).forEach(function (msgid) {
      if (typeof this._table.translations[msgctxt][msgid] !== 'object') {
        return;
      }
      if (msgctxt === '' && msgid === '') {
        return;
      }

      response.push(this._table.translations[msgctxt][msgid]);
    }.bind(this));
  }.bind(this));

  if (this._options.sort !== false) {
    if (typeof this._options.sort === 'function') {
      response = response.sort(this._options.sort);
    } else {
      response = response.sort(compare);
    }
  }
  response = response.map(function (r) {
    return this._drawBlock(r);
  }.bind(this));

  response.unshift(this._drawBlock(headerBlock, {
    msgstr: sharedFuncs.generateHeader(this._table.headers)
  }));

  if (this._charset === 'utf-8' || this._charset === 'ascii') {
    return Buffer.from(response.join('\n\n'), 'utf-8');
  } else {
    return encoding.convert(response.join('\n\n'), this._charset);
  }
};
