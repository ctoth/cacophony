import { BiquadFilterNode } from './context'

export abstract class FilterManager {
    protected _filters: BiquadFilterNode[] = [];

    addFilter(filter: BiquadFilterNode) {
        this._filters.push(filter);
    }

    removeFilter(filter: BiquadFilterNode) {
        this._filters = this._filters.filter(f => f !== filter);
    }

    applyFilters(connection: any): any {
        this._filters.reduce((prevConnection, filter) => {
            prevConnection.connect(filter);
            return filter;
        }, connection);
        return this._filters.length > 0 ? this._filters[this._filters.length - 1] : connection;
    }

    get filters() {
        return this._filters;
    }

    addFilters(filters: BiquadFilterNode[]) {
        // todo: be more efficient
        filters.forEach(filter => this.addFilter(filter));
    }


    removeFilters(filters: BiquadFilterNode[]) {
        filters.forEach(filter => this.removeFilter(filter));
    }
}

