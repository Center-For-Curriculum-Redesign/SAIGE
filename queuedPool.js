import {asyncInputTextGenfeedback} from './dummy_text.js';
import { std } from 'mathjs';

export class QueuedPool {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.taskQueue = [];
        this.activeTasks = [];
        this.results = [];
        this.allTasksDoneResolve = null;
        this.allTasksDonePromise = new Promise(resolve => {
            this.allTasksDoneResolve = resolve;
        });
        this.taskCounter = 0; // Counter to track the order of tasks
    }

    run(...promises) {
        promises.forEach(promise => {
            const taskIndex = this.taskCounter++;
            this.taskQueue.push({ promise, taskIndex });
        });
        this.processQueue();
    }

    processQueue() {
        while (this.activeTasks.length < this.maxConcurrent && this.taskQueue.length > 0) {
            const { promise, taskIndex } = this.taskQueue.shift();
            const activePromise = this.executePromise(promise, taskIndex);
            this.activeTasks.push(activePromise);

            activePromise.then(() => {
                this.activeTasks.splice(this.activeTasks.indexOf(activePromise), 1);
                if (this.taskQueue.length > 0) {
                    this.processQueue();
                } else if (this.activeTasks.length === 0) {
                    this.allTasksDoneResolve();
                }
            });
        }
    }

    async executePromise(promise, taskIndex) {
        try {
            const result = await promise;
            this.results[taskIndex] = result; // Store result at the correct index
            return result;
        } catch (error) {
            this.results[taskIndex] = error;
            return error;
        }
    }

    async finish() {
        await this.allTasksDonePromise;
        return this.results.filter(result => result !== undefined); // Filter out any uninitialized entries
    }
}

async function *timedText(text) {
    for await (let c of asyncInputTextGenfeedback(text, 100)) 
        yield c.choices[0].delta.content;

}

const asyyncPrint = async(text) => {
    for await (let c of timedText(text)) 
        process.stdout.write(c);
    console.log("")
    return text;    
}