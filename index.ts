import http from 'node:http';
import type { Ctx } from './context';
import { router, append_route } from './router';
import fs from 'node:fs';
import { storeCtx, initCtx } from './context';
import path from 'node:path';
import formidable from 'formidable';
import action from './action';
import cookie from 'cookie'
import * as view from './view';
import { parse as url_parse } from 'node:url';
type HtmlErrorHandler = (ctx: Ctx, message: string) => void
type MiddleWare = (ctx: Ctx, next: Function) => Promise<void>

let layout = (body: string) => {
    return `<!doctype html><html><head></head><body>${body}</body><html>`
}
let middlewares: MiddleWare[] = []

async function call_middleware(index: number, ctx: Ctx, route_handler: (...args: any) => any) {
    let nextFn
    try {
        if (index >= 0) {
            nextFn = async () => { await call_middleware(index - 1, ctx, route_handler) }
            await middlewares[index](ctx, nextFn)
        }
        else {
            await route_handler(ctx)
        }
    } catch (e) {
        throw e
    }
}

let app = {
    errorHandler: (ctx: Ctx, e: any) => {
        if (typeof e == 'object') { // sys generated err
            if (process.env.NODE_ENV == 'development') {
                e = e.message + `\n ${e.stack}`
                console.error(e)
            }
            else {
                e = 'sys error'
            }
        }
        if (ctx.req.method == 'POST') {
            // user error, generated by ctx.err()
            if (e.match(/^err:/)) {
                e = e.replace(/^err:/, '')
            }
            // system error
            else {
                console.log(e)
                e = 'system err'
            }
            ctx.json({ err: e })
        }
        else {
            app.htmlErrorHandler(ctx, e)
        }
    },
    htmlErrorHandler: (ctx: Ctx, message: string) => {
        // user error, generated by ctx.err()
        if (message.match(/^err:/)) {
            message = message.replace(/^err:/, '')
        }
        // system error
        else {
            if (process.env.NODE_ENV != 'development') {
                message = 'system err'
            }
        }
        ctx.res.end("Error: " + message)
    },
    use: (fn: MiddleWare) => {
        middlewares.unshift(fn)
    },
    listen: (port: number) => {
        load_pages()
        const server = http.createServer(async (req, res) => {
            let appended_elements = []
            // js
            if (req.url == '/frontless.js') {
                fs.readFile(__dirname + req.url, function (error, content) {
                    res.writeHead(200, { 'Content-Type': 'text/javascript' });
                    res.end(content, 'utf-8');
                })
                return
            }
            // css
            if (req.url == '/frontless.css') {
                fs.readFile(__dirname + req.url, function (error, content) {
                    res.writeHead(200, { 'Content-Type': 'text/css' });
                    res.end(content, 'utf-8');
                })
                return
            }
            // static
            if (req?.url?.match(/^\/static\/(.+)/)) {
                serve_static(req, res)
                return
            }
            let ctx = initCtx(req, res, layout, app.errorHandler)
            // get POST form data 
            if (req.method == 'POST') {
                const form = formidable({});
                try {
                    [ctx.body, ctx.files] = await form.parse(req);
                    for (let k in ctx.body) {
                        if (ctx.body[k].length == 1) {
                            ctx.body[k] = ctx.body[k][0]?.trim()
                        }
                    }
                } catch (err) {
                    console.error(err);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(String(err));
                    return;
                }
            }

            // route
            let page_handler: () => void
            if (req.url == '/action') {
                page_handler = action
            }
            else {
                let r = router(ctx)
                if (r.matched) {
                    page_handler = async () => {
                        try {
                            let res = await r.handler(ctx)
                            ctx.send(res)
                        } catch (e) {
                            throw e
                        }
                    }
                }
                else {
                    res.end('path not found');
                    return
                }
            }

            storeCtx(ctx, async () => {
                try {
                    await call_middleware(middlewares.length - 1, ctx, page_handler)
                } catch (e) {
                    if (ctx._sys.isSent) {
                        return
                    }
                    app.errorHandler(ctx, e)
                }
            })


        });

        server.on('clientError', (err, socket) => {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });
        server.listen(port);
        console.log(`listening on port ${port}`)
    }
}



export function load_pages(path = 'pages') {
    fs.readdirSync(process.cwd() + '/' + path).forEach(async function (filename) {
        let filepath = path + '/' + filename;
        if (fs.lstatSync(process.cwd() + '/' + filepath).isDirectory()) {
            load_pages(filepath)
        }
        else if (filename == '_layout.ts' || filename == '_layout.js') {
            let render_ = await import(process.cwd() + '/' + filepath)
            layout = render_.default
        }
        else {
            append_route_from_file({ path: filepath, name: filename })
        }
    })
}

async function append_route_from_file(file: { path: string, name: string }) {
    let route_path = file.path.replace(/\.js|\.ts$/, '').replace(/^pages\//, '')
    if (route_path == 'index') {
        route_path = ''
    }
    route_path = '/' + route_path
    let handler = await import(process.cwd() + '/' + file.path)
    append_route(route_path, handler.default)
}

function serve_static(req: http.IncomingMessage, res: http.ServerResponse) {
    let filePath = process.cwd() + req.url
    fs.readFile(filePath, function (error, content) {
        if (error) {
            res.writeHead(404);
            res.end('file not found')
        }
        else {
            var extname = path.extname(req.url ?? '');
            var contentType = 'unknown';
            switch (extname) {
                case '.html':
                    contentType = 'text/html';
                    break;
                case '.js':
                    contentType = 'text/javascript';
                    break;
                case '.css':
                    contentType = 'text/css';
                    break;
                case '.json':
                    contentType = 'application/json';
                    break;
                case '.png':
                    contentType = 'image/png';
                    break;
                case '.jpg':
                    contentType = 'image/jpg';
                    break;
                case '.wav':
                    contentType = 'audio/wav';
                    break;
                case '.svg':
                    contentType = 'image/svg+xml'
                    break;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}

type Config = {
    htmlErrorHandler?: HtmlErrorHandler,
}
export default function Frontless(config: Config = {}) {
    if (typeof config.htmlErrorHandler == 'function') {
        app.htmlErrorHandler = config.htmlErrorHandler
    }
    return app
}

