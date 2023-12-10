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
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        this.listeners.push(res);
        this.sendEventTo({ message: 'Connected to SSE' }, res);
    } 
}