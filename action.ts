const { log } = console
import { getCtx, Ctx } from "./context";
import { components, ComponentResType } from "./component";
import * as view from "./view";
let apiUrl = process.env.FRONTLESS_API_DEV_URL ?? 'https://api.frontless.dev/v1'
const action = async () => {
    let ctx = getCtx()
    log('ctx.body', ctx.body)
    if (ctx.req.method != 'POST') {
        ctx.err('POST only')
    }
    let m = ctx.req.url?.match(/\/action\/([\d\w]+)\/([\d\w]+)/) || []
    let component_name = m[1]
    let component_action = m[2]
    if (!component_action || !component_name) {
        ctx.err('no component or action')
    }

    if (component_name == 'builtin_image' && component_action == 'beforuploading') {
        if (!process.env?.FRONTLESS_KEY) {
            ctx.err('rocess.env.FRONTLESS_KEY is not set')
        }
        try {
            let r = await jsonPost(apiUrl + '/geturl', { key: process.env.FRONTLESS_KEY })
            log('got r from action.ts', r)
            if (r.status == 'ok') {
                ctx.json({ status: 'ok', preSignedUrl: r.preSignedUrl })
            }
            else {
                ctx.err(r.err ?? 'failed to verify key')
            }
        } catch (e) {
            ctx.err('failed to get presigned url')
            log(e)
        }
        return
    }
    if (typeof ctx.body.image_entries_name == 'string' && ctx.body.image_entries_name.length > 0) {
        let key = ctx.body.image_entries_name
        if (typeof ctx.body.image_entries == 'string' && ctx.body.image_entries.length > 1) {
            try {
                let r = await jsonPost(apiUrl + '/verify', { act: 'confirm', entries: ctx.body.image_entries, key: process.env.FRONTLESS_KEY })
                log('i r', r)
                if (r?.status == 'ok' && r?.images?.length > 0) {
                    ctx.body[key] = r.images
                }
                else {
                    ctx.body[key] = []
                }
            } catch (e) {
                log('failed parse img')
                ctx.body[key] = []
            }
        }
        else {
            ctx.body[key] = []
        }
    }

    let { component_key } = ctx.body
    if (typeof component_key != 'string' || typeof component_name != 'string' || typeof component_action != 'string' || !component_name || !component_action) {
        ctx.err('no componnet name or action')
    }
    // get component class by name
    let c = components.get(component_name)
    if (typeof c != 'object') {
        ctx.err('component not found: ' + component_name)
        return
    }
    // check component key
    let key
    try {
        key = JSON.parse(component_key as string)
    } catch (e) {
        throw 'failed to parse component_key ' + component_key
    }
    // check method exists
    if (!c.methods.includes(component_action)) {
        log(component_name, 'methods', c.methods)
        throw 'method does not exits:' + component_action
    }
    // create instance
    let i: any = new c.fn(key.k)
    i.action = component_action
    // call load
    if (c.methods.includes('load')) {
        let r = await i.load(component_action)
        if (r) {// if got return, send it to client
            handle_res(ctx, r)
            return
        }
    }
    // call hasAct
    if (c.methods.includes('hasAct')) {
        let r = await i.hasAct(component_action)
        if (r) {// if got return, send it to client
            handle_res(ctx, r)
            return
        }
    }
    // call action
    let r = await i[component_action]()
    if (typeof r != 'undefined') {// if got return, send it to client
        handle_res(ctx, r)
        return
    }

    // render
    let res = await i.render(component_action)
    handle_res(ctx, res)

}

function handle_res(ctx: Ctx, res: ComponentResType) {
    let cssUpdated = ''
    if (Array.isArray(ctx._sys?.cssUpdated)) {
        cssUpdated = "\n" + ctx._sys.cssUpdated.map(e => `.${e.id} {${e.str}}`).join("\n")
    }
    if (typeof res == 'undefined') {
        ctx.err('undefined res')
        return
    }
    if (typeof res == 'string') {
        ctx.json({ html: res, css: cssUpdated })
    }
    else if (Array.isArray(res)) {
        ctx.json({ html: view.column(res), css: cssUpdated })
    }
    else if (typeof res == 'object') {
        res.css = cssUpdated
        ctx.json(res)
    }
    else {
        ctx.err('no res')
    }
}
export default action;

async function jsonPost(url = "", data = {}): Promise<{ [k: string]: any }> {
    const response = await fetch(url, {
        method: "POST",
        mode: "cors",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
        },
        redirect: "error",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(data),
    });
    return await response.json() as any;
}