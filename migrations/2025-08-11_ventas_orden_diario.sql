-- Migration: agregar columna orden_diario a Ventas
ALTER TABLE public."Ventas"
  ADD COLUMN IF NOT EXISTS orden_diario integer;
