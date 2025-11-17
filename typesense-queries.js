// Typesense-specific query building logic

// Debounces the search query to prevent excessive requests to the server
window.debouncePromise = function(fn, wait) {
  let timeout;
  let pendingResolve = null;
  let lastArgs = null;
  
  return function(...args) {
    lastArgs = args;
    
    return new Promise((resolve) => {
      if (pendingResolve) {
        pendingResolve(null);
      }
      pendingResolve = resolve;
      
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const result = await fn(...args);
        if (pendingResolve === resolve) {
          resolve(result);
          pendingResolve = null;
        }
      }, wait);
    });
  };
}

// Autocomplete search query
window.debouncedSearch = window.debouncePromise(async (query) => {
  if (!query?.trim()) return null;
  
  try {
    const results = await window.typesenseClient.collections('gog_games').documents().search({
      q: query, 
      query_by: window.autocompleteFields,
      query_by_weights: window.searchFieldWeights,
      highlight_full_fields: window.autocompleteFields,
      highlight_start_tag: '<b>',
      highlight_end_tag: '</b>',
      per_page: 20,
      prefix: true,
      infix: 'always',
      prioritize_exact_match: true,
      prioritize_token_position: true,
    });
    return results;
  } catch (error) {
    console.error('Search error:', error);
    return null;
  }
}, 300);

// Helper function to extract field value from document/highlights
window.getFieldValue = function(doc, highlights, field) {
  const highlight = highlights?.find(h => h.field === field);
  return highlight?.value?.replace(/<[^>]*>/g, '') || doc[field] || '';
}

// This determines field type for array fields like Genres or Supported Operating Systems
window.getArrayValue = function(doc, highlights, field, query) {
  const arr = doc[field] || [];
  if (!arr.length) return '';
  
  const highlight = highlights?.find(h => h.field === field);
  const queryLower = query.toLowerCase();
  
  if (highlight) {
    const text = highlight.value?.replace(/<[^>]*>/g, '');
    return arr.find(v => text?.includes(v)) || 
           arr.find(v => v.toLowerCase().includes(queryLower)) || 
           arr[0];
  }
  
  return arr.find(v => v.toLowerCase().includes(queryLower)) || arr[0];
}

// Functions used to check which field the item selected matches in the current query, during onSelect():
// It falls back to checking fieldPriority order for case-insensitive substring matches if no highlights are found.
window.determineFieldType = function(item, query) {
  const { highlights, document: doc } = item;
  
  if (highlights?.length) {
    const matched = highlights.find(h => h.value?.includes('<b>'));
    if (matched) return matched.field;
    return highlights[0].field;
  }
  
  const queryLower = query.toLowerCase();
  for (const field of window.fieldPriority) {
    const value = doc[field];
    if (!value) continue;
    
    if (Array.isArray(value)) {
      if (value.some(v => v?.toLowerCase().includes(queryLower))) return field;
    } else if (value.toLowerCase().includes(queryLower)) {
      return field;
    }
  }
  
  return 'title';
}

// Helpers in autocomplete getItems() to build the suggestions list from search results: 
// collectArrayMatches finds matching values in array fields (genres, OS),
// collectFieldMatches checks string fields (developer, publisher, title) independently. 
// addAutocompleteItem prevents duplicates and limits items per field type,

window.collectArrayMatches = function(hit, query, fieldType, byCategory, seen, maxItems) {
  const { document: doc } = hit;
  const arr = doc[fieldType];
  if (!Array.isArray(arr)) return;
  
  const queryLower = query.toLowerCase();
  const match = arr.find(item => item && item.toLowerCase().includes(queryLower));
  if (match) {
    addAutocompleteItem(byCategory, seen, hit, fieldType, match, maxItems);
  }
}

// Typesense uses Highlights to mark matching query terms with <b> tags. 
// Each highlight object contains { field: 'fieldName', value: 'text with <b>matched</b> terms' }

window.collectFieldMatches = function(hit, query, byCategory, seen) {
  const { highlights, document: doc } = hit;
  const queryLower = query.toLowerCase();
  
  const fieldsToCheck = ['developer', 'publisher', 'title'];
  
  fieldsToCheck.forEach(fieldType => {
    const value = doc[fieldType];
    if (!value || typeof value !== 'string') return;
    
    if (value.toLowerCase().includes(queryLower)) {
      const highlight = highlights?.find(h => h.field === fieldType);
      const displayValue = highlight ? getFieldValue(doc, highlights, fieldType) : value;
      
      if (displayValue?.trim()) {
        addAutocompleteItem(byCategory, seen, hit, fieldType, displayValue, 3);
      }
    }
  });
}

window.addAutocompleteItem = function(byCategory, seen, hit, fieldType, value, maxItems = 3) {
  const key = `${fieldType}:${String(value).trim().toLowerCase()}`;
  if (seen.has(key)) return;
  
  seen.add(key);
  if (!byCategory[fieldType]) byCategory[fieldType] = [];
  if (byCategory[fieldType].length < maxItems) {
    byCategory[fieldType].push({ ...hit, _fieldType: fieldType, _value: value });
  }
}

// Helper functions to build the filter by the defined, excluded and undefined tags 

window.escapeFilterValue = function(value) {
  return value.replace(/"/g, '\\"');
}

window.buildDefinedFilters = function(definedByField) {
  const allFieldTypes = Object.keys(definedByField);
  if (allFieldTypes.length === 0) return undefined;
  
  const fieldFilters = allFieldTypes.map(fieldType => {
    const values = definedByField[fieldType] || [];
    
    const filters = values.map(value => {
      const escapedValue = window.escapeFilterValue(value);
      if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
        return `${fieldType}:${escapedValue}`;
      } else {
        return `${fieldType}:=${escapedValue}`;
      }
    });
    
    if (filters.length === 0) return null;
    
    if ((fieldType === 'genres' && window.genresUseAnd) || (fieldType === 'supportedOperatingSystems' && window.supportedOperatingSystemsUseAnd)) {
      return filters.length === 1 ? filters[0] : `(${filters.join(' && ')})`;
    } else {
      return filters.length === 1 ? filters[0] : `(${filters.join(' || ')})`;
    }
  }).filter(f => f !== null);
  
  return fieldFilters.join(' && ');
}

window.buildExclusionFilters = function(definedExcludeTags) {
  const exclusionFilterParts = [];
  
  definedExcludeTags.forEach(tag => {
    if (!tag.value?.trim()) return;
    const fieldType = tag.fieldType;
    const escapedValue = escapeFilterValue(tag.value.trim());
    if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
      exclusionFilterParts.push(`${fieldType}:!=${escapedValue}`);
    } else {
      exclusionFilterParts.push(`${fieldType}:!=${escapedValue}`);
    }
  });
  
  return exclusionFilterParts;
}

window.buildUndefinedExclusions = function(undefinedExcludeTags) {
  return undefinedExcludeTags
    .filter(tag => tag.value?.trim())
    .map(tag => {
      const value = tag.value.trim();
      const tokens = value.split(/\s+/).filter(t => t.length > 0);
      return tokens.map(t => `-${t}`).join(' ');
    })
    .join(' ');
}

window.buildQueryObject = function(queryString, filterBy, hasUndefinedQuery) {
  const queryObj = {
    collection: 'gog_games',
    q: queryString,
    query_by: hasUndefinedQuery ? window.searchFields : undefined,
    drop_tokens_threshold: 0,
    prioritize_exact_match: true,
    prioritize_token_position: true,
    prefix: true,
  };
  
  if (filterBy) {
    queryObj.filter_by = filterBy;
  }
  
  return queryObj;
}

// Generates the search queries for the typesense search that serves results, based on the tags selected by the user
window.generateSearchQueries = function(tags) {
  if (!tags.length) {
    return [{ collection: 'gog_games', q: '*', query_by: window.searchFields }];
  }
  
  const excludeTags = tags.filter(t => t.excludeChecked);
  const queryTags = tags.filter(t => !t.excludeChecked);
  
  const definedTags = queryTags.filter(t => t.fieldType);
  const undefinedTags = queryTags.filter(t => !t.fieldType);
  const definedExcludeTags = excludeTags.filter(t => t.fieldType);
  const undefinedExcludeTags = excludeTags.filter(t => !t.fieldType);
  
  // Group defined-type tags into an object for constructing filters
  const definedByField = {};
  definedTags.forEach(tag => {
    if (!tag.value?.trim()) return;
    const fieldType = tag.fieldType;
    if (!definedByField[fieldType]) {
      definedByField[fieldType] = [];
    }
    definedByField[fieldType].push(tag.value.trim());
  });
  
  const undefinedQueryValues = [];
  undefinedTags.forEach(tag => {
    if (tag.value?.trim()) {
      undefinedQueryValues.push(tag.value.trim());
    }
  });
  
  const definedFilterBy = window.buildDefinedFilters(definedByField);
  const exclusionFilterParts = window.buildExclusionFilters(definedExcludeTags);
  const undefinedExclusionTerms = window.buildUndefinedExclusions(undefinedExcludeTags);
  
  // Three cases: no undefined tags, one undefined tag, multiple undefined tags
  // Build the query string and filter by the defined tags and exclusion tags
  // If there is one undefined tag, add it as a query string against all fields 
  // If there are multiple undefined tags, create a list of queries for each undefined tag, that we will union together later
  if (undefinedQueryValues.length === 0) {
    const allFilterParts = [];
    if (definedFilterBy) {
      allFilterParts.push(`(${definedFilterBy})`);
    }
    allFilterParts.push(...exclusionFilterParts);
    const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;
    
    const queryString = undefinedExclusionTerms ? `* ${undefinedExclusionTerms}` : '*';
    return [window.buildQueryObject(queryString, filterBy, !!undefinedExclusionTerms)];
  } else if (undefinedQueryValues.length === 1) {
    const allFilterParts = [];
    if (definedFilterBy) {
      allFilterParts.push(`(${definedFilterBy})`);
    }
    allFilterParts.push(...exclusionFilterParts);
    const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;
    
    const queryString = undefinedExclusionTerms 
      ? `${undefinedQueryValues[0]} ${undefinedExclusionTerms}`
      : undefinedQueryValues[0];
    
    return [window.buildQueryObject(queryString, filterBy, true)];
  } else {
    return undefinedQueryValues.map(undefinedValue => {
      const allFilterParts = [];
      if (definedFilterBy) {
        allFilterParts.push(`(${definedFilterBy})`);
      }
      allFilterParts.push(...exclusionFilterParts);
      const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;
      
      const queryString = undefinedExclusionTerms 
        ? `${undefinedValue} ${undefinedExclusionTerms}`
        : undefinedValue;
      
      return window.buildQueryObject(queryString, filterBy, true);
    });
  }
};

