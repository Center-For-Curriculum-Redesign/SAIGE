const SUSChatFormatter = {
    'role_strings': {
        'system': '',
        'user': '### Human: ',
        'assistant': '### Assistant: '
    },
    'pre_role': {
        'system' : '',
        'user' : '\n',
        'assistant' : '\n',
    },
    'post_role': {
        'user' : '\n',
        'assistant' : '' //skip the new line to response string.
    }
};

const ChatML = {
    'role_strings': {
        'system': "<|im_start|>system\n",
        'user': "<|im_start|>user\n",
        'assistant': "<|im_start|>assistant\n"
    },
    'pre_role': {
        'system': '',
        'user' : '\n',
        'assistant' : '\n',
    },
    'post_role': {
        'system' : "<|im_end|>",
        'user' : "<|im_end|>",
        'assistant' : "" //skip the new line to response string.
    }
};


export const known_formats = {
    'TheBloke/SUS-Chat-34B-AWQ' : SUSChatFormatter,
    'TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-AWQ' : ChatML
}

export const inline_quote = {
    'system': '',
    'role_strings': {
        'user': '\nUserMessage: ',
        'assistant': '\nAssistantMessage: '
    },
    'pre_role': {
        'user' : '\n',
        'assistant' : '\n',
    },
    'post_role': {
        'user' : '',
        'assistant' : ''
    }
};