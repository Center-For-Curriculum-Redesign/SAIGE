const evertext = "This is the song that doesn't end.\n \
Yes, it goes on and on, my friend.\n \
Some people started singing it, not knowing what it was.\n \
And, they'll continue singing it forever, just because\n "
const everword = evertext.split(" ")


export async function* asyncIntGen(duration, maxIterations = Infinity) {
    let iteration = 0;  

    while (iteration <= maxIterations) {
        await new Promise(resolve => setTimeout(resolve, duration));
        iteration += 1;
        let word = (iteration) % everword.length;
        let newchunk = everword[word-1];
        const resultPart = {choices: [{delta : {content : ' '+newchunk}}]};
        yield resultPart;
    }
}