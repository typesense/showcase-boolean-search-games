// Shared state and constants used across modules

window.typesenseClient = new Typesense.Client({
  apiKey: window.TYPESENSE_SEARCH_ONLY_API_KEY || 'xyz',
  nodes: [{ url: window.TYPESENSE_URL || 'http://localhost:8108' }],
  connectionTimeoutSeconds: 2,
});

window.tags = [];
window.tagIdCounter = 0;
window.currentPage = 1;
window.resultsPerPage = 10;
window.totalResults = 0;
window.genresUseAnd = false;
window.supportedOperatingSystemsUseAnd = false;
window.pendingGuideLinkField = null;

window.fieldLabels = {
  title: 'title',
  developer: 'developer',
  publisher: 'publisher',
  genres: 'genre',
  supportedOperatingSystems: 'OS',
};

window.autocompleteFields = 'genres,supportedOperatingSystems,developer,publisher,title';
window.searchFieldWeights = '5,4,3,2,1';
window.searchFields = 'title,developer,publisher,genres,supportedOperatingSystems';
window.fieldPriority = ['genres', 'supportedOperatingSystems', 'developer', 'publisher', 'title'];

