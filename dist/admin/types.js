"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.AdminError = void 0;
// A command that couldn't be carried out, with a message for the admin. Any
// other error thrown inside a command is a bug and is reported as such.
class AdminError extends Error {
}
exports.AdminError = AdminError;
const fail = (message) => { throw new AdminError(message); };
exports.fail = fail;
