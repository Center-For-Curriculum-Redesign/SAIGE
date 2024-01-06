const evertext = "This is the song that doesn't end.\n \
Yes, it goes on and on, my friend.\n \
Some people started singing it, not knowing what it was.\n \
And, they'll continue singing it forever, just because\n "
const everword = evertext.split(" ")

let chunked = [`sure,`, ` let `, `me just sea`, `rch ab`, `out hed`, `gehogs`, `. <meta-sea`, `rch> hedgehogs`, `, are the`, `y hedges, or`, ` dogs? </meta-`, `searc`, `h>`,` but I c`, `an't p`, `romise any`, `thing`]


export async function* asyncIntGen(duration=100, maxIterations = Infinity) {
    let iteration = 0;
    let increments = 0;   

    while (iteration < maxIterations) {
        await new Promise(resolve => setTimeout(resolve, duration));
        increments += 1;
        let word = (increments-1) % chunked.length;
        let newchunk = chunked[word];
        const resultPart = {choices: [{delta : {content : newchunk}}]};
        if(increments % chunked.length == 0) 
            iteration++;
        yield resultPart;       
    }
}