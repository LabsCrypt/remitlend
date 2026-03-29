# Validation Middleware

This directory contains middleware for validating incoming requests using Zod.

## Usage

The `validate` middleware function accepts a Zod schema and validates the request against it.

### Example

```typescript
import { validate } from "../middleware/validation.js";
import { mySchema } from "../schemas/mySchemas.js";

router.post("/endpoint", validate(mySchema), myController);
```

## Schema Structure

Schemas should validate the following request properties:

- `body` - Request body data
- `params` - URL parameters
- `query` - Query string parameters

### Example Schema

```typescript
import { z } from "zod";

export const mySchema = z.object({
  body: z.object({
    name: z.string().min(1),
    age: z.number().positive(),
  }),
  params: z.object({
    id: z.string(),
  }),
});
```

## Error Response Format

When validation fails, the middleware returns a 400 status with:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "path": "body.fieldName",
      "message": "Error message"
    }
  ]
}
```
