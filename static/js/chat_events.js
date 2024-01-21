class EventSourceManager {
    constructor(url) {
        this.currenturl = null;
        this.eventTypeCallbackMap = {};
        this.changeSource(url, 'init');
    }

    changeSource(url, reason) {
        if(this.currenturl != url) {
            let old_evs = this.evs;
            this.evs = new EventSource(url);
            this.notify({
                event_name: 'source_changed',
                subtype: null,
                server_timestamp: null,
                manager: this,
                payload: {
                    reason: reason,
                    old_url : this.currenturl,
                    new_url : url,
                    old_evs : old_evs,
                    new_evs : this.evs
                }
            })
            old_evs?.close();
            this.currenturl = url;
            
            this.init();            
        }
    }   

    init = () => {
        this.eventTypeCallbackMap = {};
        this.evs.onmessage = (e) => {
            let data = JSON.parse(e.data);
            data.manager = this;    
            this.notify(data);
        };

        this.evs.onerror = (e) => {
            console.error(e);
        };
    }

    notify = (event) => {
        console.log(event);
        let candidates = this.eventTypeCallbackMap[event.event_name];
        candidates?.forEach(listener => {
            listener(event);
        });
    }


    addListener(l) {
        let candidates = this.eventTypeCallbackMap[l.event_name];
        if(candidates == null) {
            candidates = [];
            this.eventTypeCallbackMap[l.event_name] = candidates;
        }
        if(!candidates.includes(l.callback)) {
            candidates.push(l.callback);
        }
    }

    removeListener(l) {
        let candidates = this.eventTypeCallbackMap[l.event_name];
        let existsAt = -1;
        do {
            existsAt = candidates.indexOf(l.callback);
            if(existsAt > -1)
                candidates.splice(existsAt, 1);
        } while(existsAt > -1)
    }
}