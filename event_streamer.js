export class EventStreamer {
    constructor(res) {
        this.listeners = [];
        if(res != null) {
            this.registerListener(res);            
        }
    }

    broadcastEvent(data) {
        if(data.server_timestamp == null)
                data.server_timestamp = Number(new Date());

        this.listeners.forEach(res => {            
            this.sendEventTo(data, res);
        })
    };

    sendEventTo(data, res) {
        if(data.server_timestamp == null)
                data.server_timestamp = Number(new Date());
        let stringed = JSON.stringify(data);
        res.write(`data: ${stringed}\n\n`);
    };

    removeListener(res) {
        for(var i=0; i<this.listeners.length; i++){
            if(this.listeners[i] == res) {
                this.listeners.splice(i, 1);
                break;
            }
        }
    }

    registerListener(res) {
        res.req.on('close', () => {
            this.removeListener(res);
            console.log('Client disconnected');
        });
        if(this.listeners.includes(res)) {
            return;
        }
        const headers = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        };
    
        // Add the Connection header only for HTTP/1.1 requests
        if (res.req.httpVersion === '1.1') {
            headers.Connection = 'keep-alive';
        }
        res.writeHead(200, headers);
        this.listeners.push(res);
        this.sendEventTo({ event_name: "ack", message: 'Connected to SSE' }, res);
    } 
}