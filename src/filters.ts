import { BiquadFilterNode } from './context'

export abstract class FilterManager {
    protected filters: BiquadFilterNode[] = [];

    addFilter(filter: BiquadFilterNode) {
        this.filters.push(filter);
    }

    removeFilter(filter: BiquadFilterNode) {
        this.filters = this.filters.filter(f => f !== filter);
    }

    applyFilters(connection: any): any {
        this.filters.reduce((prevConnection, filter) => {
            prevConnection.connect(filter);
            return filter;
        }, connection);
        return this.filters.length > 0 ? this.filters[this.filters.length - 1] : connection;
    }
}

