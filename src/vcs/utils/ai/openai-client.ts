import OpenAI from "openai";
import { Block } from "@prisma/client";
import { BlockProxy } from "../../database/proxy-types";
import { prismaClient } from "../../database/client";
import log from "electron-log"

let   OPENAI: OpenAI | undefined = undefined;
const MODEL                      = "gpt-3.5-turbo"

try {
    OPENAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch {
    log.warn("Failed to load OpenAI API.")
}


export default class CodeAI {

    private static readonly temperature:      number                   = 0
    private static readonly maxTokens:        number                   = 256
    private static readonly stop:             string | string[] | null = null
    private static readonly topP:             number                   = 1
    private static readonly frequencyPenalty: number                   = 0
    private static readonly presencePenalty:  number                   = 0

    public static async errorSuggestion(code: string, errorMessage: string): Promise<string | null> {
        
        const messages: OpenAI.ChatCompletionMessageParam[] = [
            { role: "system", content: "You are a coding assistant helping with creative coding using P5JS. Specifically, you should provide support for debugging code." },
            { role: "user",   content: `The following code results in this error message: "${errorMessage}". How could I fix that?\n${code}` }
        ]

        try {
            const chatCompletion = await OPENAI.chat.completions.create({
                model:             MODEL,
                messages:          messages,
                temperature:       this.temperature,
                max_tokens:        this.maxTokens,
                stop:              this.stop,
                top_p:             this.topP,
                frequency_penalty: this.frequencyPenalty,
                presence_penalty:  this.presencePenalty
            });

            return chatCompletion.choices[0].message.content
        } catch {
            if (OPENAI !== undefined) { log.warn("Failed to generate error suggestion!") }
            return null
        }
    }

    public readonly root:  BlockProxy
    public readonly block: BlockProxy

    private readonly versionNameHistory: OpenAI.ChatCompletionMessageParam[]

    private readonly temperature:      number                   = CodeAI.temperature
    private readonly maxTokens:        number                   = CodeAI.maxTokens
    private readonly stop:             string | string[] | null = CodeAI.stop
    private readonly topP:             number                   = CodeAI.topP
    private readonly frequencyPenalty: number                   = CodeAI.frequencyPenalty
    private readonly presencePenalty:  number                   = CodeAI.presencePenalty

    public static async create(block: BlockProxy, blockData: Block): Promise<CodeAI> {
        const root               = await block.getFileRoot()
        const versionNameHistory = JSON.parse(blockData.aiVersionNameHistory)
        return new CodeAI(root, block, versionNameHistory)
    }

    private constructor(root: BlockProxy, block: BlockProxy, versionNameHistory: OpenAI.ChatCompletionMessageParam[]) {
        this.root               = root
        this.block              = block
        this.versionNameHistory = versionNameHistory
    }

    private async getCompleteCode(): Promise<string> {
        return await this.root.getText([this.block])
    }

    public async generateVersionInfo(versionCode: string): Promise<{ name: string, description: string }> {
        const systemMessage: OpenAI.ChatCompletionMessageParam = {
            role:    "system",
            content: `You are a coding assistant helping with creative coding using P5JS. Consider the following code for all requests:\n${await this.getCompleteCode()}`
        }

        const requestMessage: OpenAI.ChatCompletionMessageParam = {
            role:    "user",
            content: `Provide a name and description that allows to quickly grasp the unique impact of this code segment. Avoid textual references to previous code snippets.\n${versionCode}`
        }


        const versionInfo = { name: `Tag ${this.block.tags.length + 1}`, description: "No description available." }
        
        try {
            const chatCompletion = await OPENAI.chat.completions.create({
                model:             MODEL,
                messages:          [systemMessage, ...this.versionNameHistory, requestMessage],
                temperature:       this.temperature,
                max_tokens:        this.maxTokens,
                stop:              this.stop,
                top_p:             this.topP,
                frequency_penalty: this.frequencyPenalty,
                presence_penalty:  this.presencePenalty
            });

            // NOTE: This is not always the same format, so sometimes, I might end up with no title or description... AI and stuff... ugh.
            const response = chatCompletion.choices[0].message
            const lines    = response.content.split("\n")

            versionInfo.name = lines[0].replace('Name:', '').replace(new RegExp('"', "g"), '').trim()

            // this is meant to fail to take the default description instead of taking a faulty one
            let descriptionIndex = 1
            let description      = ""
            while (description.length < 10) { description = lines[descriptionIndex++].replace('Description: ', '').trim() }
            versionInfo.description = description

            this.versionNameHistory.push(requestMessage, response)

            await prismaClient.block.update({
                where: { id: this.block.id },
                data:  {
                    aiVersionNameHistory: JSON.stringify(this.versionNameHistory)
                }
            })
        } catch {
            if (OPENAI !== undefined) {
                log.warn("Failed to generate version info!")
            }
        }

        return versionInfo
    }
}