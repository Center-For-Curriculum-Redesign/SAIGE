const SUSChatFormatter = {
    'role_strings': {
        'system': '',
        'user': '### Human: ',
        'assistant': '### Assistant: '
    },
    'pre_role': {
        'user' : '\n',
        'assistant' : '\n',
    },
    'post_role': {
        'user' : '\n',
        'assistant' : '' //skip the new line to response string.
    }
};


export const known_formats ={
    'TheBloke/SUS-Chat-34B-AWQ' : SUSChatFormatter,
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
        'user' : '\n',
        'assistant' : '\n'
    }
};