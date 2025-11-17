// Main entry point - initializes the application

function init() {
  const autocompleteContainer = document.getElementById('autocomplete');
  if (autocompleteContainer && !document.getElementById('tags-container')) {
    const guidingText = document.createElement('div');
    guidingText.id = 'guiding-text';
    guidingText.className = 'guiding-text';
    autocompleteContainer.parentNode.insertBefore(guidingText, autocompleteContainer.nextSibling);
    
    window.updateGuidingText();
    
    const tagsContainer = document.createElement('div');
    tagsContainer.id = 'tags-container';
    tagsContainer.className = 'tags-container';
    autocompleteContainer.parentNode.insertBefore(tagsContainer, guidingText.nextSibling);
  }
  
  const main = document.querySelector('main');
  if (main && !document.getElementById('results-container')) {
    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'results-container';
    resultsContainer.className = 'results-container';
    resultsContainer.innerHTML = '<div id="results-list"></div><div id="results-pagination"></div>';
    main.appendChild(resultsContainer);
  }
  
  window.renderTags();
  window.setupEnterKeyHandler();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
