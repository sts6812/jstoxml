const privateVars = ['_selfCloseTag', '_attrs'];
const privateVarsJoined = privateVars.join('|');
const privateVarsRegexp = new RegExp(privateVarsJoined, 'g');

/**
 * Determines the indent string based on current tree depth.
 */
const getIndentStr = (baseIndentStr = '', depth = 0) => baseIndentStr.repeat(depth);

/**
 * Sugar function supplementing JS's quirky typeof operator, plus some extra help to detect
 * "special objects" expected by jstoxml.
 */
const getType = val => {
  let type;
  if (Array.isArray(val)) {
    type = 'array';
  } else if (typeof val === 'object' && val !== null && val._name) {
    type = 'special-object';
  } else if (val instanceof Date) {
    type = 'date';
  } else if (val === null) {
    type = 'null';
  } else {
    type = typeof val;
  }

  return type;
};

/**
 * Replaces matching values in a string with a new value.
 * Example:
 * filterStr('foo&bar', { '&': '&amp;' });
 */
const filterStr = (inputStr = '', filter = {}) => {
  const searches = Object.keys(filter);
  const joinedSearches = searches.join('|');
  const regexpStr = `(${joinedSearches})`;
  const regexp = new RegExp(regexpStr, 'g');

  return String(inputStr).replace(regexp, (str, entity) => filter[entity] || '');
};

/**
 * Maps an object or array of arribute keyval pairs to a string.
 * Examples:
 * { foo: 'bar', baz: 'g' } -> 'foo="bar" baz="g"'
 * [ { key: '⚡', val: true }, { foo: 'bar' } ] -> '⚡ foo="bar"'
 */
const getAttributeKeyVals = (attributes = {}, filter) => {
  const isArray = Array.isArray(attributes);

  let keyVals = [];
  if (isArray) {
    // Array containing complex objects and potentially duplicate attributes.
    keyVals = attributes.map(attr => {
      const key = Object.keys(attr)[0];
      const val = attr[key];

      const filteredVal = (filter) ? filterStr(val, filter) : val;
      const valStr = (filteredVal === true) ? '' : `="${filteredVal}"`;
      return `${key}${valStr}`;
    });
  } else {
    const keys = Object.keys(attributes);
    keyVals = keys.map(key => {
      // Simple object - keyval pairs.

      // For boolean true, simply output the key.
      const filteredVal = (filter) ? filterStr(attributes[key], filter) : attributes[key];
      const valStr = (attributes[key] === true) ? '' : `="${filteredVal}"`;

      return `${key}${valStr}`;
    });
  }

  return keyVals;
};

/**
 * Converts an attributes object to a string of keyval pairs.
 * Example:
 * formatAttributes({ a: 1, b: 2 })
 * -> 'a="1" b="2"'
 */
const formatAttributes = (attributes = {}, filter) => {
  const keyVals = getAttributeKeyVals(attributes, filter);
  if (keyVals.length === 0) return '';

  const keysValsJoined = keyVals.join(' ');
  return ` ${keysValsJoined}`;
};

/**
 * Converts an object to a jstoxml array.
 * Example:
 * objToArray({ foo: 'bar', baz: 2 });
 * ->
 * [
 *   {
 *     _name: 'foo',
 *     _content: 'bar'
 *   },
 *   {
 *     _name: 'baz',
 *     _content: 2
 *   }
 * ]
 */
const objToArray = (obj = {}) => (Object.keys(obj).map(key => ({
  _name: key,
  _content: obj[key]
})));

/**
 * Determines if a value is a simple primitive type that can fit onto one line.  Needed for
 * determining any needed indenting and line breaks.
 */
const isSimpleType = val => {
  const valType = getType(val);
  return (valType === 'string' || valType === 'number' || valType === 'boolean' ||
    valType === 'date' || valType === 'special-object');
};

/**
 * Determines if an XML string is a simple primitive, or contains nested data.
 */
const isSimpleXML = xmlStr => !xmlStr.match('<');

/**
 * Assembles an XML header as defined by the config.
 */
const defaultHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const getHeaderString = (config, depth, isOutputStart) => {
  let headerStr = '';
  const shouldOutputHeader = config.header && isOutputStart;
  if (shouldOutputHeader) {
    const shouldUseDefaultHeader = typeof config.header === 'boolean';
    headerStr = (shouldUseDefaultHeader) ? defaultHeader : config.header;

    if (config.indent) headerStr += '\n';
  }

  return headerStr;
};

/**
 * Recursively traverses an object tree and converts the output to an XML string.
 */
export const toXML = (obj = {}, config = {}) => {
  // Determine tree depth.
  const depth = (config.depth) ? config.depth : 0;

  // Determine indent string based on depth.
  const indentStr = getIndentStr(config.indent, depth);

  // For branching based on value type.
  const valType = getType(obj);
  const isSimple = isSimpleType(obj);

  // Determine if this is the start of the output.  Needed for header and indenting.
  const isOutputStart = depth === 0 && (isSimple || (!isSimple && config._isFirstItem));

  let outputStr = '';
  switch (valType) {
  case 'special-object': {
    // Processes a specially-formatted object used by jstoxml.

    const { _name, _content } = obj;

    // Output text content without a tag wrapper.
    if (_content === null) {
      outputStr = _name;
      break;
    }

    // Don't output private vars (such as _attrs).
    if (_name.match(privateVarsRegexp)) break;

    // Process the nested new value and config.
    const newConfig = Object.assign({}, config, { depth: depth + 1 });
    const newVal = toXML(_content, newConfig);
    const newValType = getType(newVal);
    const isNewValSimple = isSimpleXML(newVal);

    // Pre-tag output (indent and line breaks).
    const preIndentStr = (config.indent && !isOutputStart) ? '\n' : '';
    const preTag = `${preIndentStr}${indentStr}`;

    // Tag output.
    const valIsEmpty = newValType === 'undefined' || newVal === '';
    const shouldSelfClose = (typeof obj._selfCloseTag === 'boolean') ?
      (valIsEmpty && obj._selfCloseTag) :
      valIsEmpty;
    const selfCloseStr = (shouldSelfClose) ? '/' : '';
    const attributesString = formatAttributes(obj._attrs, config.attributesFilter);
    const tag = `<${_name}${attributesString}${selfCloseStr}>`;

    // Post-tag output (closing tag, indent, line breaks).
    const preTagCloseStr = (config.indent && !isNewValSimple) ? `\n${indentStr}` : '';
    const postTag = (!shouldSelfClose) ? `${newVal}${preTagCloseStr}</${_name}>` : '';

    outputStr = `${preTag}${tag}${postTag}`;
    break;
  }

  case 'object': {
    // Iterates over keyval pairs in an object, converting each item to a special-object.

    const keys = Object.keys(obj);
    const outputArr = keys.map((key, index) => {
      const newConfig = Object.assign({}, config, {
        _isFirstItem: index === 0,
        _isLastItem: ((index + 1) === keys.length)
      });

      const outputObj = { _name: key };

      if (getType(obj[key]) === 'object') {
        // Sub-object contains an object.

        // Move private vars up as needed.  Needed to support certain types of objects
        // E.g. { foo: { _attrs: { a: 1 } } } -> <foo a="1"/>
        privateVars.forEach(privateVar => {
          const val = obj[key][privateVar];
          if (typeof val !== 'undefined') {
            outputObj[privateVar] = val;
            delete obj[key][privateVar];
          }
        });

        const hasContent = typeof obj[key]._content !== 'undefined';
        if (hasContent) {
          // _content has sibling keys, so pass as an array (edge case).
          // E.g. { foo: 'bar', _content: { baz: 2 } } -> <foo>bar</foo><baz>2</baz>
          if (Object.keys(obj[key]).length > 1) {
            const newContentObj = Object.assign({}, obj[key]);
            delete newContentObj._content;

            outputObj._content = [
              ...objToArray(newContentObj),
              obj[key]._content
            ];
          }
        }
      }

      // Fallthrough: just pass the key as the content for the new special-object.
      if (typeof outputObj._content === 'undefined') outputObj._content = obj[key];

      const xml = toXML(outputObj, newConfig);

      return xml;
    }, config);

    outputStr = outputArr.join('');
    break;
  }

  case 'function': {
    // Executes a user-defined function and return output.

    const fnResult = obj(config);

    outputStr = toXML(fnResult, config);
    break;
  }

  case 'array': {
    // Iterates and converts each value in an array.

    const outputArr = obj.map((singleVal, index) => {
      const newConfig = Object.assign({}, config, {
        _isFirstItem: index === 0,
        _isLastItem: ((index + 1) === obj.length)
      });
      return toXML(singleVal, newConfig);
    });

    outputStr = outputArr.join('');
    break;
  }

  case 'number':
  case 'string':
  case 'boolean':
  case 'date':
  case 'null':
  default: {
    outputStr = filterStr(obj, config.filter);
    break;
  }
  }

  const headerStr = getHeaderString(config, depth, isOutputStart);

  outputStr = `${headerStr}${outputStr}`;

  return outputStr;
};
