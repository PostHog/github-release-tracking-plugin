# PostHog Schema Enforcer Plugin (WIP)

## Objective

This plugin allows users to specify schemas for events ingested so that they can prevent the ingestion of events that don't match a specified schema.

## What it currently does

Prevents ingestion if the event:

-   Is missing a required property
-   Has a property with the wrong type
-   Is not included in the file and `onlyIngestEventsFromFile` is `true`

It also:

-   Removes all other properties from an event except selected ones if `acceptOnlySchemaProps` is `true`

> Configuration is done via a JSON file uploaded as a plugin attachment

## Example config file

```json
{
    "onlyIngestEventsFromFile": true,
    "eventSchemas": {
        "testEvent": {
            "acceptOnlySchemaProps": true,
            "schema": {
                "foo": {
                    "type": "string",
                    "required": false
                },
                "bar": {
                    "type": "number",
                    "required": true
                },
                "baz": {
                    "type": "boolean",
                    "required": false
                }
            }
        }
    }
}
```

## To Do

### Short Term

-   Create an interface to generate the config file (In Progress)
-   Friendlier config (e.g. accept `1`, `'true'`, and `true` for toggles)
-   More config options, such as:
    -   List of events to ingest
    -   Thresholds (e.g. 'greater than' for `number` type)
    -   Default values
    -   ...
-   Tests

### Future

-   Accept YAML
-   Powerful threshold and filtering
-   More options for what to do with "bad events" beyond not ingesting them
