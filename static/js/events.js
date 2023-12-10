const eventSource = new EventSource('https://eron.ccrdev.us:3333/events');
var textOut = document.getElementById("textOut")


eventSource.onmessage = function(e) {
    let data = JSON.parse(e.data);    
    if(data.type == "pingchunk") {
        textOut.textContent += ' '+data.chunk_content;
    } else if(data.type == 'commit') {
        textOut.textContent = data.content;
    }
};

eventSource.onerror = function(e) {
    console.error('EventSource failed.');
};


/*
const newword_template = document.createElement('span')
//adds the word in the order it was emitted (timestamped) as opposed to the order received.
async function squeeze_in(newword, container) {
    for(let i = container.children.length-1; i>=0; i--) {
        if(container.children[i].time <= newword.time) {     
            container.insertBefore(newword, container.children[i])
            return;
        }
    }
    container.appendChild(newword);
}*/