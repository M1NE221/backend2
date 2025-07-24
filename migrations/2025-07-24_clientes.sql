-- Migration: Crear tabla Clientes y enlazar Ventas
-- Ejecutar en Supabase o Postgres

-- 1. Tabla Clientes (si no existe)
CREATE TABLE IF NOT EXISTS public."Clientes" (
  cliente_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public."Usuarios"(usuario_id),
  nombre text NOT NULL,
  email text,
  telefono text,
  creado_en timestamptz DEFAULT now()
);

-- Índice para búsquedas rápidas por usuario + nombre
CREATE INDEX IF NOT EXISTS idx_clientes_usuario_nombre
  ON public.Clientes(usuario_id, lower(nombre));

-- 2. Columna cliente_id en Ventas (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns 
    WHERE table_name = 'Ventas' 
      AND column_name = 'cliente_id'
  ) THEN
    ALTER TABLE public."Ventas"
      ADD COLUMN cliente_id uuid REFERENCES public."Clientes"(cliente_id);
  END IF;
END$$; 