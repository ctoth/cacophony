export type FilterCloneOverrides = {
  filters?: BiquadFilterNode[];
};

export abstract class FilterManager {
  _filters: BiquadFilterNode[] = [];

  /**
   * Adds a BiquadFilterNode to the filter chain.
   * @param {BiquadFilterNode} filter - The filter to add.
   * @throws {Error} If the same filter instance is added twice.
   */
  addFilter(filter: BiquadFilterNode) {
    // Prevent adding the same filter instance twice (would break Web Audio graph topology)
    if (this._filters.includes(filter)) {
      throw new Error("Cannot add the same filter instance twice");
    }
    this._filters.push(filter);
  }

  /**
   * Removes a BiquadFilterNode from the filter chain by object identity.
   * @param {BiquadFilterNode} filter - The filter to remove.
   * @throws {Error} If the filter was never added to this container.
   */
  removeFilter(filter: BiquadFilterNode) {
    // Remove by object identity, not by comparing property values
    // This prevents bugs where filters with identical properties can't be removed
    const initialLength = this._filters.length;
    this._filters = this._filters.filter((f) => f !== filter);

    // Error if filter was not in the array (nothing was removed)
    if (this._filters.length === initialLength) {
      throw new Error("Cannot remove filter that was never added to this container");
    }
  }

  applyFilters(connection: any): any {
    this._filters.reduce((prevConnection, filter) => {
      prevConnection.connect(filter);
      return filter;
    }, connection);
    return this._filters.length > 0
      ? this._filters[this._filters.length - 1]
      : connection;
  }

  get filters() {
    return this._filters;
  }

  addFilters(filters: BiquadFilterNode[]) {
    // todo: be more efficient
    filters.forEach((filter) => this.addFilter(filter));
  }

  removeFilters(filters: BiquadFilterNode[]) {
    filters.forEach((filter) => this.removeFilter(filter));
  }

  cleanup(): void {
    // Disconnect all filters before removing them
    this._filters.forEach(filter => filter.disconnect());
    this._filters = [];
  }
}
