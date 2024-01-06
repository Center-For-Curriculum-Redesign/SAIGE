import { inline_quote } from "./known_formats.js";

export class Formatter {
    constructor(tokenizer = null, custom_format = null) {
        this.tokenizer = tokenizer;
        this.custom_format = custom_format;
    }

    stringCompletionFormat(messageNodes, systemPrompt = null, addGenerationPrompt = true) {
        let formatted = '';
        //let df = this.determineFormat
        for (let m of messageNodes) {
            if (m.getAuthor() == null && m.getContent() == null) {
                continue; //empty root node
            }
            formatted += `${this.determineFormat()['pre_role'][m.getAuthor()]}` +
                `${this.determineFormat()['role_strings'][m.getAuthor()]}` +
                `${m.getContent()}` + 
                `${m.getState() != 'committed' ? '' : this.determineFormat()['post_role'][m.getAuthor()]}`;
        }

        if (systemPrompt) {
            formatted += systemPrompt;
        }
        if (addGenerationPrompt) {
            formatted += `${this.determineFormat()['pre_role']['assistant']}${this.determineFormat()['role_strings']['assistant']}`;
        }
        return formatted;
    }

    roleChatFormat(messageNodes, systemPrompt = null, addGenerationPrompt = true) {
        let messageDictList = [];
        let lastRole = 'system';
        if (systemPrompt !== null) {
            messageDictList.push({ role: 'system', content: systemPrompt });
        }
        for (let i = 0; i < messageNodes.length; i++) {
            let m = messageNodes[i];
            if (m.getAuthor() == null && m.getContent() == null) {
                continue; //empty root node
            }
            if (lastRole === m.getAuthor()) {
                messageDictList[i].content += `\n---\n ${m.getContent()}`;
            } else {
                messageDictList.push({
                    role: m.getAuthor(),
                    content: m.getContent()
                });
            }
            lastRole = m.getAuthor();
        }
        return messageDictList;
    }


    determineFormat() {
        if (this.custom_format == null) {
            return inline_quote;
        } else return this.custom_format;
    }
}
