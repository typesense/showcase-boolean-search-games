# Games Tag Search - powered by Typesense 🎮🔍

This demonstration showcases a tag-based search implementation powered by Typesense, using a publicly available dataset of video games from the GOG store on Kaggle [here](https://www.kaggle.com/datasets/lunthu/gog-com-video-games-dataset/data). The search interface enables querying across multiple dimensions including game titles, genres, publishers, developers, and supported operating systems.

In a search context, 'Tags' function as searchable keywords that enable precise document filtering and retrieval. In this implementation, any indexed field within a document can serve as a tag to refine search results. The interface provides an autocompleting search input that suggests tag completions across multiple fields in real-time. Users may select suggested completions from the dropdown menu or manually enter tags as "All Fields" queries, which are processed as conventional text search terms across all indexed fields.

## Setup

1. Install Node.js dependencies (for build scripts):

```shell
npm install
```

2. Set up Python virtual environment and install dependencies:

```shell
npm run setup
```

This may take a while to finish as it sets up a new python venv

## Get started

To run this project locally:

1. Start the typesense server

```shell
docker compose up
```

2. Download the dataset and index it into Typesense

```shell
# For local development (uses default 'xyz' key):
npm run index

# For production Typesense cluster, set the admin API key and connection details:
export TYPESENSE_ADMIN_API_KEY=your_admin_key_here
export TYPESENSE_PORT=443
export TYPESENSE_PROTOCOL=https
# For single-node cluster
export TYPESENSE_HOST=your-cluster.a1.typesense.net  
# For HA cluster
export TYPESENSE_HOST_NEAREST=your-cluster.a1.typesense.net  
export TYPESENSE_HOST=your-cluster-1.a1.typesense.net
export TYPESENSE_HOST_2=your-cluster-2.a1.typesense.net
export TYPESENSE_HOST_3=your-cluster-3.a1.typesense.net
npm run index
```

3. Open the `index.html` file in the root of this repo in a web browser.
