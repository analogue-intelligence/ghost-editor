import * as monaco from "monaco-editor"

function setupColorPicker(): void {
    // not sure what's up with "hue" and "saturation", but they didn't work as expected so far...
    // "new p5.Color" requires extra argument
    const keywords = ["color", "fill", "red", "green", "blue", "alpha", "brightness", "lightness", "new Color", "background", "stroke"]

    // setup in-editor color picker for P5JS
    monaco.languages.registerColorProvider("javascript", {
        provideColorPresentations: (model: monaco.editor.ITextModel, colorInfo: monaco.languages.IColorInformation, token: monaco.CancellationToken) => {
    
            const color = colorInfo.color
            const range = colorInfo.range
    
            const originalText      = model.getValueInRange(range)
            const indexFirstBracket = originalText.indexOf("(")
    
            if (indexFirstBracket < 0) { throw new Error("Invalid keyword requested for color representation!") }
    
            const keyword = originalText.substring(0, indexFirstBracket)
    
            const red   = Math.round(color.red   * 255)
            const green = Math.round(color.green * 255)
            const blue  = Math.round(color.blue  * 255)
            const alpha = Math.round(color.alpha * 255)
    
            let label: string;
            if (color.alpha === 1) {
                if (red === green && red === blue) {
                    label = keyword + "(" + red + ")";
                } else {
                    label = keyword + "(" + red + ", " + green + ", " + blue + ")";
                }
            } else {
                label = keyword + "(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
            }
    
            return [
                {
                    label,
                    textEdit: {
                        range,
                        text: label
                    }
                },
            ];
        },
    
        provideDocumentColors: (model: monaco.editor.ITextModel, token: monaco.CancellationToken) => {
    
            const colorLocations: monaco.languages.IColorInformation[] = []
    
            for (const keyword of keywords) {
                // * instead of + to allow for match and picker display if no argument is given, even though that errors
                const matches = model.findMatches(keyword + '\\(\\s*[\\d,\\s]+\\s*\\)', true, true, true, null, false)
                for (const match of matches) {
                    const range = match.range
    
                    const colorRange = {
                        startLineNumber: range.startLineNumber,
                        startColumn:     range.startColumn + keyword.length + 1,
                        endLineNumber:   range.endLineNumber,
                        endColumn:       range.endColumn - 1
                    }
    
                    const colorString = model.getValueInRange(colorRange)
                    const colorValues = colorString.split(",")
    
                    const colorValueToFloat = (colorValue: string) => {
                        return parseInt(colorValue.trim()) / 255
                    }
                    
                    let color: monaco.languages.IColor
                    if (colorValues.length < 3) {
                        if (colorValues.length > 0) {
                            const colorValue = colorValues.length > 0 ? colorValueToFloat(colorValues[0]) : 0
                            color = { red: colorValue, green: colorValue, blue: colorValue, alpha: 1 }
                        } else {
                            color = { red: 1, green: 1, blue: 1, alpha: 1 }
                        }
                    } else if (colorValues.length === 3) {
                        const red   = colorValueToFloat(colorValues[0])
                        const green = colorValueToFloat(colorValues[1])
                        const blue  = colorValueToFloat(colorValues[2])
                        color = { red, green, blue, alpha: 1 }
                    } else {
                        const red   = colorValueToFloat(colorValues[0])
                        const green = colorValueToFloat(colorValues[1])
                        const blue  = colorValueToFloat(colorValues[2])
                        const alpha = colorValueToFloat(colorValues[3])
                        color = { red, green, blue, alpha }
                    }
    
                    colorLocations.push({
                        color,
                        range: range
                    })
                }
            }
    
            return colorLocations
        },
    });
}

// Thanks for this: https://stackoverflow.com/questions/63310682/how-to-load-npm-module-type-definition-in-monaco-using-webpack-and-react-create/63349650#63349650
// Monaco Demo:     https://microsoft.github.io/monaco-editor/playground.html?source=v0.40.0#example-extending-language-services-configure-javascript-defaults
function setupAutocomplete(): void {

    // This call may scream ERROR, but this is a webpack function that exists and works.
    // But I have no idea to make that clear to VS Code...

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const typeDefinitions = require.context('!!raw-loader!@types/p5', true, /\.d.ts$/);

    typeDefinitions.keys().forEach((relativePath: string) => {
        const content = typeDefinitions(relativePath).default
        monaco.typescript.javascriptDefaults.addExtraLib(content, 'ts:' + relativePath.substring(2));
    });
}

export function setupP5JS(): void {
    setupColorPicker()
    setupAutocomplete()
}