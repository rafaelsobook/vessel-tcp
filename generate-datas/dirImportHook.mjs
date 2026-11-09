// Node resolve hook for genCrystalHollows.mjs. infterrain's bundle imports
// "@babylonjs/loaders/glTF" the way a bundler allows and Node doesn't (a bare
// directory) - retry those as <dir>/index.js.
export async function resolve(spec, ctx, next) {
    try { return await next(spec, ctx) }
    catch (e) {
        if (e.code === "ERR_UNSUPPORTED_DIR_IMPORT") return next(spec.replace(/\/?$/, "/index.js"), ctx)
        throw e
    }
}
