const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Update a sale for a specific user
 * @param {string} venta_id - Sale ID to update
 * @param {string} usuarioId - User ID (owner of the sale)
 * @param {object} updateData - Data to update (only allowed fields)
 * @returns {object} { data, error } - Supabase format response
 */
const updateSale = async (venta_id, usuarioId, updateData) => {
  try {
    logger.info('Updating sale:', {
      venta_id,
      usuarioId,
      updateData
    });

    // Update the sale with user ownership verification
    const { data, error } = await supabaseAdmin
      .from('Ventas')
      .update(updateData)
      .eq('venta_id', venta_id)
      .eq('usuario_id', usuarioId) // Ensure user owns the sale
      .select()
      .single();

    if (error) {
      logger.error('Failed to update sale:', {
        error,
        venta_id,
        usuarioId,
        updateData
      });
      return { data: null, error };
    }

    logger.info('Sale updated successfully:', {
      venta_id,
      usuarioId,
      updatedData: data
    });

    return { data, error: null };

  } catch (error) {
    logger.error('updateSale failed:', {
      error: error.message,
      stack: error.stack,
      venta_id,
      usuarioId,
      updateData
    });
    return { 
      data: null, 
      error: { 
        message: 'Internal server error', 
        code: 'INTERNAL_ERROR' 
      } 
    };
  }
};

/**
 * Delete a sale for a specific user
 * @param {string} venta_id - Sale ID to delete
 * @param {string} usuarioId - User ID (owner of the sale)
 * @returns {object} { data, error } - Supabase format response
 */
const deleteSale = async (venta_id, usuarioId) => {
  try {
    logger.info('Deleting sale:', {
      venta_id,
      usuarioId
    });

    // First, delete related records (if needed, depending on your database constraints)
    // Note: If you have foreign key constraints with CASCADE, this might not be necessary
    
    // Delete sale details first
    const { error: detailsError } = await supabaseAdmin
      .from('Detalle_ventas')
      .delete()
      .eq('venta_id', venta_id);

    if (detailsError) {
      logger.warn('Failed to delete sale details (might not exist):', {
        error: detailsError,
        venta_id
      });
      // Continue anyway as details might not exist
    }

    // Delete sale payments
    const { error: paymentsError } = await supabaseAdmin
      .from('Pagos_venta')
      .delete()
      .eq('venta_id', venta_id);

    if (paymentsError) {
      logger.warn('Failed to delete sale payments (might not exist):', {
        error: paymentsError,
        venta_id
      });
      // Continue anyway as payments might not exist
    }

    // Delete the main sale record with user ownership verification
    const { data, error } = await supabaseAdmin
      .from('Ventas')
      .delete()
      .eq('venta_id', venta_id)
      .eq('usuario_id', usuarioId) // Ensure user owns the sale
      .select()
      .single();

    if (error) {
      logger.error('Failed to delete sale:', {
        error,
        venta_id,
        usuarioId
      });
      return { data: null, error };
    }

    logger.info('Sale deleted successfully:', {
      venta_id,
      usuarioId,
      deletedData: data
    });

    return { data, error: null };

  } catch (error) {
    logger.error('deleteSale failed:', {
      error: error.message,
      stack: error.stack,
      venta_id,
      usuarioId
    });
    return { 
      data: null, 
      error: { 
        message: 'Internal server error', 
        code: 'INTERNAL_ERROR' 
      } 
    };
  }
};

module.exports = {
  updateSale,
  deleteSale
};