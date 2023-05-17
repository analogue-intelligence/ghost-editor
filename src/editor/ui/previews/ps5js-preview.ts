import { Disposable } from "../../utils/types";
import { uuid } from "../../utils/uuid";
import { CodePreview } from "./preview";
import { iframeResize } from "iframe-resizer"

export interface SizeConstraints {
    maxWidth?: number
    maxHeight?: number
    padding?: number
}

export class P5JSPreview extends CodePreview {

    private static p5jsScript = new URL("./libs/p5js/p5.min.js", document.baseURI).href
    private static iframeResizerScript = new URL("./libs/iframe-resizer/iframeResizer.contentWindow.min.js", document.baseURI).href

    private readonly uuid: string = uuid(16)
    private readonly iframe: HTMLIFrameElement

    private readonly sizeConstraints?: SizeConstraints
    private onResizeCallbacks: {(width: number, height: number): void}[] = []

    private get id(): string {
        return `p5js-preview-${this.uuid}`
    }

    private get html(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="X-UA-Compatible" content="IE=edge">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>p5.js Live Preview</title>

                <style>
                    body {
                        padding: 0;
                        margin: 0;
                    }
                </style>

                <script src="${P5JSPreview.p5jsScript}"></script>
            </head>
            <body>

                <script>
                    // setup config object of iFrameResizer
                    window.iFrameResizer = {
                        onMessage: (data) => {
                            console.log("MESSAGE")
                            p5Canvas = document.getElementsByClassName("p5Canvas")
                            for (let i = 0; i < p5Canvas.length; i++) {
                                const canvas = p5Canvas[i]
                                canvas.style.width = data.width + "px"
                                canvas.style.height = data.height + "px"
                            }
                        }
                    }
                </script>
                <script src="${P5JSPreview.iframeResizerScript}"></script>

                <script>
                    function createErrorMessage(text) {
                        const errorMessage = document.createElement("div")

                        errorMessage.setAttribute("data-iframe-width", "")
                        errorMessage.innerText = text

                        document.body.appendChild(errorMessage);
                    }

                    const code = ${JSON.stringify(this.code)}

                    if (!code.includes("setup") || !code.includes("draw")) {
                        createErrorMessage("Your code must include a setup and a draw function to be rendered in this P5JS preview.")
                    } else {
                        try {
                            eval(code)
                        } catch (error) {
                            createErrorMessage(error.message)
                        }
                    }
                </script>

                <script>
                    // workaround to allow the use of taggedElement for width calculation when sizing the iframe
                    window.addEventListener("load", event => {
                        p5Canvas = document.getElementsByClassName("p5Canvas")
                        for (let i = 0; i < p5Canvas.length; i++) {
                            p5Canvas[i].setAttribute("data-iframe-width", "")
                        }
                    })
                </script>
            </body>
            </html>
        `
    }

    private get htmlUrl(): string {
        const htmlBlob = new Blob([this.html], { type: 'text/html' });
        return URL.createObjectURL(htmlBlob);
    }

    public get style(): CSSStyleDeclaration {
        return this.iframe.style
    }

    private get padding(): number {
        return this.sizeConstraints?.padding ? this.sizeConstraints.padding : 0
    }

    private get maxWidth(): number | undefined {
        return this.sizeConstraints?.maxWidth
    }

    private get maxHeight(): number | undefined {
        return this.sizeConstraints?.maxHeight
    }

    constructor(root: HTMLElement, code?: string, sizeConstraints?: SizeConstraints) {
        super(root, code)
        this.sizeConstraints = sizeConstraints

        this.iframe = document.createElement("iframe") as HTMLIFrameElement
        this.iframe.id = this.id

        // make sure preview is displayed with minimal unused space
        this.iframe.frameBorder = "0"
        this.style.border = "none"
        this.style.padding = `${this.padding}px ${this.padding}px`
        this.style.margin = "0 0"

        let loadHandler: () => void
        loadHandler = () => {
            this.iframe.removeEventListener("load", loadHandler)
            this.setup()
            if (this.code) { this.render() }
        }

        this.iframe.addEventListener("load", loadHandler)
        this.root.appendChild(this.iframe)
    }

    private setup(): void {
        const onResize  = (data) => { this.resize(data.iframe, data.width, data.height) }
        const betterIframe = iframeResize({ /*log: true,*/ 
                                            checkOrigin: ["file://"], 
                                            sizeWidth: true, 
                                            widthCalculationMethod: 'taggedElement', 
                                            tolerance: 5,
                                            onResized: onResize
                                          }, `#${this.id}`)[0]
    }

    private padValue(value: number): number {
        return value - 2 * this.padding
    }

    private resize(iframe: any, renderWidth: number, renderHeight: number): void {
        const computedStyle = window.getComputedStyle(this.root);
        const width  = this.padValue(Math.min(this.maxWidth  ? this.maxWidth  : Number.MAX_SAFE_INTEGER, parseFloat(computedStyle.width)))
        const height = this.padValue(Math.min(this.maxHeight ? this.maxHeight : Number.MAX_SAFE_INTEGER, parseFloat(computedStyle.height)))

        /*
        console.log("CURRENT")
        console.log(iframe.style.width)
        console.log(iframe.style.height)
        console.log("DESIRED")
        console.log(width)
        console.log(height)
        console.log("---------------------")
        */

        iframe.iFrameResizer.sendMessage({ width: width, height: height })
        iframe.style.width = width
        iframe.style.width = height

        this.onResizeCallbacks.forEach(callback => callback(width, height))
    }

    public onResize(callback: (width: number, height: number) => void): Disposable {
        this.onResizeCallbacks.push(callback)

        const parent = this

        return this.addSubscription({
            dispose(): void {
                const index = parent.onResizeCallbacks.indexOf(callback, 0)
                if (index > -1) { parent.onResizeCallbacks = parent.onResizeCallbacks.splice(index, 1) }
            }
        })
    }

    public override async render(): Promise<void> {
        this.iframe.src = this.htmlUrl
    }
}