-- Add server-side trailing-stop state to orders table.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS max_favorable_price DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS current_trailing_stop DOUBLE PRECISION;
