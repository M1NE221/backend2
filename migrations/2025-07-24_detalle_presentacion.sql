-- Migration: añadir columna presentacion a Detalle_ventas
ALTER TABLE public."Detalle_ventas"
  ADD COLUMN IF NOT EXISTS presentacion text; 