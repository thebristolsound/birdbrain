// stdout carries the MCP protocol, so a stray console.log anywhere in the
// imported services would corrupt a message. Imported first by the entry so
// the redirect is in place before any other module evaluates.
console.log = console.error
console.info = console.error
console.debug = console.error
