export class EventStreamer {
    constructor(res, user_id) {
        this.listeners = [];
        if(res != null && user_id != null) {
            this.registerListener(res, user_id);
        }
    }

    broadcastEvent(data, user_id ) {
        if(data.server_timestamp == null)
                data.server_timestamp = Number(new Date());

        this.listeners.forEach(res => {                    
                this.sendEventTo(data, res, user_id);
        })
    };

    sendEventTo(data, res, user_id) {
        if(data.server_timestamp == null)
                data.server_timestamp = Number(new Date());
        if((res.user_id != null && res.user_id == user_id)
        || res.user_id == 'global') {    
            let stringed = JSON.stringify(data);
            res.write(`data: ${stringed}\n\n`);
        }
    };

    removeListener(res) {
        for(var i=0; i<this.listeners.length; i++){
            if(this.listeners[i] == res) {
                this.listeners.splice(i, 1);
                break;
            }
        }
    }

    registerListener(res, user_id) {
        if(user_id = null) {
            throw new Error("User_id required");
        }
        res.user_id = user_id;
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
        this.sendEventTo({ event_name: "ack", message: 'Connected to SSE' }, res, user_id);
    } 
}