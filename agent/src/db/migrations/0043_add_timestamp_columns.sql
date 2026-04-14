-- Add default Created / Updated columns to every data table that doesn't
-- already have them. These columns render each row's createdAt / updatedAt
-- timestamp in the UI. They're regular columns — users can remove them via
-- the normal removeColumn flow and they won't reappear.

-- Add the Created column where missing.
UPDATE data_tables
SET
  columns = json_insert(
    columns,
    '$[#]',
    json('{"id":"__created_time__","name":"Created","type":"created_time","config":{}}')
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(data_tables.columns)
  WHERE json_extract(value, '$.type') = 'created_time'
);

-- Add the Updated column where missing.
UPDATE data_tables
SET
  columns = json_insert(
    columns,
    '$[#]',
    json('{"id":"__updated_time__","name":"Updated","type":"updated_time","config":{}}')
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(data_tables.columns)
  WHERE json_extract(value, '$.type') = 'updated_time'
);
