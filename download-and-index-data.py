import json
import os
import ast
import pandas as pd
import kagglehub
from typesense import Client
from tqdm import tqdm

import os

# Typesense connection
# Use TYPESENSE_ADMIN_API_KEY from environment, fallback to 'xyz' for local dev
typesense_api_key = os.getenv('TYPESENSE_ADMIN_API_KEY', 'xyz').strip()
typesense_host = (os.getenv('TYPESENSE_HOST_NEAREST') or os.getenv('TYPESENSE_HOST', 'localhost')).strip()
typesense_port = os.getenv('TYPESENSE_PORT', '8108').strip()
typesense_protocol = os.getenv('TYPESENSE_PROTOCOL', 'http').strip()

# Support multiple nodes if provided (for high availability)
nodes = []
# Use primary node
nodes.append({
    'host': typesense_host,
    'port': typesense_port,
    'protocol': typesense_protocol
})
if os.getenv('TYPESENSE_HOST_NEAREST'):
    # Use nearest endpoint (recommended for Typesense Cloud)
    nodes.append({
        'host': typesense_host,  # Use the already-stripped host
        'port': typesense_port,
        'protocol': typesense_protocol
    })
    # Add additional nodes if provided
    if os.getenv('TYPESENSE_HOST_2'):
        nodes.append({
            'host': os.getenv('TYPESENSE_HOST_2').strip(),
            'port': typesense_port,
            'protocol': typesense_protocol
        })
    if os.getenv('TYPESENSE_HOST_3'):
        nodes.append({
            'host': os.getenv('TYPESENSE_HOST_3').strip(),
            'port': typesense_port,
            'protocol': typesense_protocol
        })
else:
    # Local development fallback
    nodes.append({
        'host': 'localhost',
        'port': '8108',
        'protocol': 'http'
    })

typesense_client = Client({
    'api_key': typesense_api_key,
    'nodes': nodes,
    'connection_timeout_seconds': 2
})

COLLECTION_NAME = 'gog_games'

# Download dataset
print("Downloading dataset from Kaggle...")
path = kagglehub.dataset_download("lunthu/gog-com-video-games-dataset")
csv_file = [f for f in os.listdir(path) if f.endswith('.csv')][0]

# Read CSV and select required fields
df = pd.read_csv(os.path.join(path, csv_file))
df = df[['developer', 'publisher', 'genres', 'releaseDate', 'title', 'supportedOperatingSystems', 'amount']]

# Parse string lists to actual lists
def parse_list(x):
    if pd.isna(x): return []
    if isinstance(x, list): return x
    try:
        return json.loads(x) if isinstance(x, str) else []
    except:
        try:
            return ast.literal_eval(x) if isinstance(x, str) else []
        except:
            return x.split(',') if isinstance(x, str) else []

for col in ['genres', 'supportedOperatingSystems']:
    df[col] = df[col].apply(parse_list)

# Process records in memory
documents = []
for _, row in tqdm(df.iterrows(), total=len(df), desc="Processing records", unit="record"):
    record = row.to_dict()
    # Convert releaseDate to int (not float) and handle nulls
    if pd.isna(record.get('releaseDate')) or record.get('releaseDate') is None:
        # Remove null releaseDate from record (optional field)
        record.pop('releaseDate', None)
    else:
        record['releaseDate'] = int(record['releaseDate'])
    # Remove null/NaN/empty values from other fields
    filtered_record = {}
    for k, v in record.items():
        if isinstance(v, list):
            # Keep non-empty lists
            if v:
                filtered_record[k] = v
        elif pd.isna(v) or v is None or v == '':
            # Skip null/NaN/empty values
            continue
        else:
            filtered_record[k] = v
    documents.append(filtered_record)

# Delete existing collection (if it exists)
print(f"\nChecking for existing collection '{COLLECTION_NAME}'...")
try:
    existing = typesense_client.collections[COLLECTION_NAME].retrieve()
    print(f"  Found existing collection, deleting...")
    typesense_client.collections[COLLECTION_NAME].delete()
    print(f"✓ Deleted existing collection '{COLLECTION_NAME}'")
except Exception as e:
    if 'Not Found' in str(e) or '404' in str(e):
        print(f"  Collection '{COLLECTION_NAME}' doesn't exist (will create new one)")
    else:
        print(f"  Warning when checking/deleting collection: {e}")
        # Continue anyway - might be a permissions issue but create might still work

# Create collection with schema
collection_schema = {
    'name': COLLECTION_NAME,
    'fields': [
        {'name': 'developer', 'type': 'string', 'infix': True},
        {'name': 'publisher', 'type': 'string', 'infix': True},
        {'name': 'genres', 'type': 'string[]', 'facet': True, 'infix': True},
        {'name': 'releaseDate', 'type': 'int64', 'optional': True, 'infix': True},
        {'name': 'title', 'type': 'string', 'infix': True},
        {'name': 'supportedOperatingSystems', 'type': 'string[]', 'facet': True, 'infix': True},
        {'name': 'amount', 'type': 'float', 'infix': True}
    ]
}

print(f"\nCreating collection '{COLLECTION_NAME}'...")
try:
    result = typesense_client.collections.create(collection_schema)
    print(f"✓ Successfully created collection '{COLLECTION_NAME}'")
except Exception as e:
    error_str = str(e)
    if 'already exists' in error_str.lower() or 'duplicate' in error_str.lower():
        print(f"  Collection already exists, continuing...")
    elif '401' in error_str or 'Unauthorized' in error_str or 'Forbidden' in error_str:
        print(f"✗ ERROR: API key doesn't have permission to create collections!")
        print(f"  API Key being used: {typesense_api_key[:8]}... (length: {len(typesense_api_key)})")
        print(f"  Make sure you're using TYPESENSE_ADMIN_API_KEY with full admin permissions")
        raise
    else:
        print(f"✗ ERROR creating collection: {e}")
        raise

# Add synonyms to the collection
# Synonyms allow equivalent terms to match each other in searches
synonyms_list = [
    {
        "id": "and-synonyms",
        "synonyms": ["and", "&", "+"]
    },
    {
        "id": "versus-synonyms",
        "synonyms": ["versus", "vs"]
    },
    {
        "id": "one-synonyms",
        "synonyms": ["ine", "1","I"]
    },
    {
        "id": "two-synonyms",
        "synonyms": ["two", "2","II"]
    },
    {
        "id": "three-synonyms",
        "synonyms": ["three", "3","III"]
    }
]

for synonym in synonyms_list:
    try:
        typesense_client.collections[COLLECTION_NAME].synonyms.upsert(
            synonym['id'],
            {
                "synonyms": synonym['synonyms']
            }
        )
    except Exception as e:
        pass

# Import data in batches
batch_size = 100

with tqdm(total=len(documents), desc="Indexing documents", unit="doc") as pbar:
    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        try:
            # import_ returns a generator of results, consume it to ensure indexing completes
            results = list(typesense_client.collections[COLLECTION_NAME].documents.import_(batch, {'action': 'create'}))
            pbar.update(len(batch))
        except Exception as e:
            print(f"\n✗ Error indexing batch starting at index {i}: {e}")
            raise

# Clean up - release memory
del df
del documents