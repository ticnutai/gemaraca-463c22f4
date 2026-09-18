export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      data_backups: {
        Row: {
          buckets: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          kind: string
          label: string
          notes: string | null
          status: string
          storage_path: string | null
          tables: Json
          topics: string[]
          total_bytes: number
          total_rows: number
        }
        Insert: {
          buckets?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          label: string
          notes?: string | null
          status?: string
          storage_path?: string | null
          tables?: Json
          topics?: string[]
          total_bytes?: number
          total_rows?: number
        }
        Update: {
          buckets?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          label?: string
          notes?: string | null
          status?: string
          storage_path?: string | null
          tables?: Json
          topics?: string[]
          total_bytes?: number
          total_rows?: number
        }
        Relationships: []
      }
      data_restores: {
        Row: {
          backup_id: string | null
          buckets: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          mode: string
          safety_backup_id: string | null
          source: string
          source_name: string | null
          status: string
          tables: Json
        }
        Insert: {
          backup_id?: string | null
          buckets?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          mode: string
          safety_backup_id?: string | null
          source?: string
          source_name?: string | null
          status?: string
          tables?: Json
        }
        Update: {
          backup_id?: string | null
          buckets?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          mode?: string
          safety_backup_id?: string | null
          source?: string
          source_name?: string | null
          status?: string
          tables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "data_restores_backup_id_fkey"
            columns: ["backup_id"]
            isOneToOne: false
            referencedRelation: "data_backups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_restores_safety_backup_id_fkey"
            columns: ["safety_backup_id"]
            isOneToOne: false
            referencedRelation: "data_backups"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_items: {
        Row: {
          answer: string
          created_at: string
          id: string
          order_index: number | null
          psak_din_id: string
          question: string
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          order_index?: number | null
          psak_din_id: string
          question: string
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          order_index?: number | null
          psak_din_id?: string
          question?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faq_items_psak_din_id_fkey"
            columns: ["psak_din_id"]
            isOneToOne: false
            referencedRelation: "psakei_din"
            referencedColumns: ["id"]
          },
        ]
      }
      folder_categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      function_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          function_name: string
          id: string
          ip_address: string | null
          request_body: Json | null
          response_summary: string | null
          status: string
          status_code: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          function_name: string
          id?: string
          ip_address?: string | null
          request_body?: Json | null
          response_summary?: string | null
          status?: string
          status_code?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          function_name?: string
          id?: string
          ip_address?: string | null
          request_body?: Json | null
          response_summary?: string | null
          status?: string
          status_code?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      gemara_edit_snapshots: {
        Row: {
          created_at: string
          edited_html: string
          id: string
          sugya_id: string
          text_settings: Json | null
          updated_at: string
          user_id: string
          view_mode: string
        }
        Insert: {
          created_at?: string
          edited_html?: string
          id?: string
          sugya_id: string
          text_settings?: Json | null
          updated_at?: string
          user_id: string
          view_mode?: string
        }
        Update: {
          created_at?: string
          edited_html?: string
          id?: string
          sugya_id?: string
          text_settings?: Json | null
          updated_at?: string
          user_id?: string
          view_mode?: string
        }
        Relationships: []
      }
      gemara_pages: {
        Row: {
          book: string | null
          categories: Json | null
          created_at: string
          daf_number: number
          daf_yomi: string
          he_ref: string | null
          id: string
          masechet: string
          section_ref: string | null
          sefaria_ref: string
          sugya_id: string
          text_en: Json | null
          text_he: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          book?: string | null
          categories?: Json | null
          created_at?: string
          daf_number: number
          daf_yomi: string
          he_ref?: string | null
          id?: string
          masechet?: string
          section_ref?: string | null
          sefaria_ref: string
          sugya_id: string
          text_en?: Json | null
          text_he?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          book?: string | null
          categories?: Json | null
          created_at?: string
          daf_number?: number
          daf_yomi?: string
          he_ref?: string | null
          id?: string
          masechet?: string
          section_ref?: string | null
          sefaria_ref?: string
          sugya_id?: string
          text_en?: Json | null
          text_he?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      migration_history: {
        Row: {
          created_at: string
          description: string | null
          error_message: string | null
          executed_at: string | null
          executed_by: string | null
          execution_time_ms: number | null
          id: string
          name: string
          rows_affected: number | null
          source: string
          source_url: string | null
          sql_content: string
          status: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          error_message?: string | null
          executed_at?: string | null
          executed_by?: string | null
          execution_time_ms?: number | null
          id?: string
          name: string
          rows_affected?: number | null
          source?: string
          source_url?: string | null
          sql_content: string
          status?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          error_message?: string | null
          executed_at?: string | null
          executed_by?: string | null
          execution_time_ms?: number | null
          id?: string
          name?: string
          rows_affected?: number | null
          source?: string
          source_url?: string | null
          sql_content?: string
          status?: string
        }
        Relationships: []
      }
      modern_examples: {
        Row: {
          created_at: string
          daf_yomi: string
          examples: Json
          id: string
          masechet: string
          practical_summary: string
          principle: string
          sugya_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daf_yomi: string
          examples?: Json
          id?: string
          masechet: string
          practical_summary: string
          principle: string
          sugya_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daf_yomi?: string
          examples?: Json
          id?: string
          masechet?: string
          practical_summary?: string
          principle?: string
          sugya_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      page_typography_settings: {
        Row: {
          created_at: string
          font_family: string
          font_size: number
          id: string
          line_height: number
          page_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          font_family?: string
          font_size?: number
          id?: string
          line_height?: number
          page_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          font_family?: string
          font_size?: number
          id?: string
          line_height?: number
          page_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pattern_sugya_links: {
        Row: {
          amud: string | null
          confidence: string
          created_at: string
          daf: string | null
          id: string
          masechet: string
          psak_din_id: string
          source_text: string
          sugya_id: string
        }
        Insert: {
          amud?: string | null
          confidence?: string
          created_at?: string
          daf?: string | null
          id?: string
          masechet: string
          psak_din_id: string
          source_text: string
          sugya_id: string
        }
        Update: {
          amud?: string | null
          confidence?: string
          created_at?: string
          daf?: string | null
          id?: string
          masechet?: string
          psak_din_id?: string
          source_text?: string
          sugya_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pattern_sugya_links_psak_din_id_fkey"
            columns: ["psak_din_id"]
            isOneToOne: false
            referencedRelation: "psakei_din"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_annotations: {
        Row: {
          book_id: string
          color: string | null
          created_at: string | null
          highlight_rects: Json | null
          highlight_text: string | null
          id: string
          note_text: string
          page_number: number
          position_x: number | null
          position_y: number | null
          updated_at: string | null
        }
        Insert: {
          book_id: string
          color?: string | null
          created_at?: string | null
          highlight_rects?: Json | null
          highlight_text?: string | null
          id?: string
          note_text: string
          page_number: number
          position_x?: number | null
          position_y?: number | null
          updated_at?: string | null
        }
        Update: {
          book_id?: string
          color?: string | null
          created_at?: string | null
          highlight_rects?: Json | null
          highlight_text?: string | null
          id?: string
          note_text?: string
          page_number?: number
          position_x?: number | null
          position_y?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_annotations_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "user_books"
            referencedColumns: ["id"]
          },
        ]
      }
      psak_sections: {
        Row: {
          created_at: string | null
          id: string
          psak_din_id: string
          section_content: string
          section_order: number
          section_title: string
          section_type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          psak_din_id: string
          section_content: string
          section_order?: number
          section_title: string
          section_type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          psak_din_id?: string
          section_content?: string
          section_order?: number
          section_title?: string
          section_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "psak_sections_psak_din_id_fkey"
            columns: ["psak_din_id"]
            isOneToOne: false
            referencedRelation: "psakei_din"
            referencedColumns: ["id"]
          },
        ]
      }
      psakei_din: {
        Row: {
          beautify_count: number
          case_number: string | null
          case_summary: string | null
          category: string | null
          content_hash: string | null
          court: string
          created_at: string
          full_text: string | null
          id: string
          search_vector: unknown
          source_url: string | null
          summary: string
          tags: string[] | null
          title: string
          updated_at: string
          year: number
        }
        Insert: {
          beautify_count?: number
          case_number?: string | null
          case_summary?: string | null
          category?: string | null
          content_hash?: string | null
          court: string
          created_at?: string
          full_text?: string | null
          id?: string
          search_vector?: unknown
          source_url?: string | null
          summary: string
          tags?: string[] | null
          title: string
          updated_at?: string
          year: number
        }
        Update: {
          beautify_count?: number
          case_number?: string | null
          case_summary?: string | null
          category?: string | null
          content_hash?: string | null
          court?: string
          created_at?: string
          full_text?: string | null
          id?: string
          search_vector?: unknown
          source_url?: string | null
          summary?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      shas_download_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          current_daf: number
          errors: Json
          hebrew_name: string
          id: string
          loaded_pages: number
          masechet: string
          max_daf: number
          started_at: string | null
          status: string
          total_pages: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_daf?: number
          errors?: Json
          hebrew_name: string
          id?: string
          loaded_pages?: number
          masechet: string
          max_daf: number
          started_at?: string | null
          status?: string
          total_pages?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_daf?: number
          errors?: Json
          hebrew_name?: string
          id?: string
          loaded_pages?: number
          masechet?: string
          max_daf?: number
          started_at?: string | null
          status?: string
          total_pages?: number
          updated_at?: string
        }
        Relationships: []
      }
      shas_pdf_pages: {
        Row: {
          amud: string
          created_at: string | null
          daf_number: number
          file_size: number | null
          hebrew_name: string
          id: string
          masechet: string
          pdf_url: string | null
          seder: string
          storage_path: string
        }
        Insert: {
          amud: string
          created_at?: string | null
          daf_number: number
          file_size?: number | null
          hebrew_name: string
          id?: string
          masechet: string
          pdf_url?: string | null
          seder: string
          storage_path: string
        }
        Update: {
          amud?: string
          created_at?: string | null
          daf_number?: number
          file_size?: number | null
          hebrew_name?: string
          id?: string
          masechet?: string
          pdf_url?: string | null
          seder?: string
          storage_path?: string
        }
        Relationships: []
      }
      smart_index_results: {
        Row: {
          analysis_method: string
          books: string[]
          created_at: string
          has_full_text: boolean
          id: string
          masechtot: string[]
          psak_din_id: string
          sources: Json
          topics: Json
          updated_at: string
          word_count: number
        }
        Insert: {
          analysis_method?: string
          books?: string[]
          created_at?: string
          has_full_text?: boolean
          id?: string
          masechtot?: string[]
          psak_din_id: string
          sources?: Json
          topics?: Json
          updated_at?: string
          word_count?: number
        }
        Update: {
          analysis_method?: string
          books?: string[]
          created_at?: string
          has_full_text?: boolean
          id?: string
          masechtot?: string[]
          psak_din_id?: string
          sources?: Json
          topics?: Json
          updated_at?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "smart_index_results_psak_din_id_fkey"
            columns: ["psak_din_id"]
            isOneToOne: true
            referencedRelation: "psakei_din"
            referencedColumns: ["id"]
          },
        ]
      }
      sugya_psak_links: {
        Row: {
          connection_explanation: string
          created_at: string
          id: string
          psak_din_id: string
          relevance_score: number | null
          sugya_id: string
        }
        Insert: {
          connection_explanation: string
          created_at?: string
          id?: string
          psak_din_id: string
          relevance_score?: number | null
          sugya_id: string
        }
        Update: {
          connection_explanation?: string
          created_at?: string
          id?: string
          psak_din_id?: string
          relevance_score?: number | null
          sugya_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sugya_psak_links_psak_din_id_fkey"
            columns: ["psak_din_id"]
            isOneToOne: false
            referencedRelation: "psakei_din"
            referencedColumns: ["id"]
          },
        ]
      }
      talmud_references: {
        Row: {
          amud: string | null
          confidence: string
          confidence_factors: Json | null
          confidence_score: number | null
          context_snippet: string | null
          corrected_normalized: string | null
          created_at: string
          daf: string
          id: string
          normalized: string
          psak_din_id: string
          raw_reference: string
          source: string
          tractate: string
          user_id: string | null
          validation_status: string
        }
        Insert: {
          amud?: string | null
          confidence?: string
          confidence_factors?: Json | null
          confidence_score?: number | null
          context_snippet?: string | null
          corrected_normalized?: string | null
          created_at?: string
          daf: string
          id?: string
          normalized: string
          psak_din_id: string
          raw_reference: string
          source?: string
          tractate: string
          user_id?: string | null
          validation_status?: string
        }
        Update: {
          amud?: string | null
          confidence?: string
          confidence_factors?: Json | null
          confidence_score?: number | null
          context_snippet?: string | null
          corrected_normalized?: string | null
          created_at?: string
          daf?: string
          id?: string
          normalized?: string
          psak_din_id?: string
          raw_reference?: string
          source?: string
          tractate?: string
          user_id?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "talmud_references_psak_din_id_fkey"
            columns: ["psak_din_id"]
            isOneToOne: false
            referencedRelation: "psakei_din"
            referencedColumns: ["id"]
          },
        ]
      }
      text_annotations: {
        Row: {
          created_at: string
          end_offset: number
          id: string
          original_text: string
          source_id: string
          source_type: string
          start_offset: number
          styles: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_offset: number
          id?: string
          original_text: string
          source_id: string
          source_type: string
          start_offset: number
          styles?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_offset?: number
          id?: string
          original_text?: string
          source_id?: string
          source_type?: string
          start_offset?: number
          styles?: Json
          updated_at?: string
        }
        Relationships: []
      }
      upload_sessions: {
        Row: {
          created_at: string
          current_file: string | null
          device_id: string | null
          failed_files: number
          id: string
          processed_files: number
          session_id: string
          skipped_files: number
          status: string
          successful_files: number
          total_files: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_file?: string | null
          device_id?: string | null
          failed_files?: number
          id?: string
          processed_files?: number
          session_id: string
          skipped_files?: number
          status?: string
          successful_files?: number
          total_files?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_file?: string | null
          device_id?: string | null
          failed_files?: number
          id?: string
          processed_files?: number
          session_id?: string
          skipped_files?: number
          status?: string
          successful_files?: number
          total_files?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_books: {
        Row: {
          created_at: string | null
          edited_text: string | null
          edited_text_updated_at: string | null
          file_name: string | null
          file_url: string
          id: string
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          edited_text?: string | null
          edited_text_updated_at?: string | null
          file_name?: string | null
          file_url: string
          id?: string
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          edited_text?: string | null
          edited_text_updated_at?: string | null
          file_name?: string | null
          file_url?: string
          id?: string
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_pinned_items: {
        Row: {
          amud: string | null
          color: string | null
          created_at: string
          daf: string | null
          id: string
          item_id: string
          item_type: string
          label: string
          pin_type: string
          ref_count: number | null
          tractate: string | null
          user_id: string
        }
        Insert: {
          amud?: string | null
          color?: string | null
          created_at?: string
          daf?: string | null
          id?: string
          item_id: string
          item_type: string
          label: string
          pin_type?: string
          ref_count?: number | null
          tractate?: string | null
          user_id: string
        }
        Update: {
          amud?: string | null
          color?: string | null
          created_at?: string
          daf?: string | null
          id?: string
          item_id?: string
          item_type?: string
          label?: string
          pin_type?: string
          ref_count?: number | null
          tractate?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          ai_fab_position: Json | null
          created_at: string
          gemara_daf_theme: string | null
          id: string
          recently_viewed_psakim: Json | null
          sugya_view_mode: string | null
          updated_at: string
          user_id: string
          viewer_mode: string | null
        }
        Insert: {
          ai_fab_position?: Json | null
          created_at?: string
          gemara_daf_theme?: string | null
          id?: string
          recently_viewed_psakim?: Json | null
          sugya_view_mode?: string | null
          updated_at?: string
          user_id: string
          viewer_mode?: string | null
        }
        Update: {
          ai_fab_position?: Json | null
          created_at?: string
          gemara_daf_theme?: string | null
          id?: string
          recently_viewed_psakim?: Json | null
          sugya_view_mode?: string | null
          updated_at?: string
          user_id?: string
          viewer_mode?: string | null
        }
        Relationships: []
      }
      user_prompt_templates: {
        Row: {
          created_at: string
          id: string
          label: string
          order_index: number
          prompt_text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          order_index?: number
          prompt_text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          order_index?: number
          prompt_text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      backup_assert_admin: { Args: never; Returns: undefined }
      backup_catalog: { Args: never; Returns: Json }
      backup_delete_missing: {
        Args: { p_keep: string[]; p_table: string }
        Returns: Json
      }
      backup_excluded_tables: { Args: never; Returns: string[] }
      backup_export_rows: {
        Args: { p_after?: string; p_limit?: number; p_table: string }
        Returns: Json
      }
      backup_restore_rows: {
        Args: { p_mode?: string; p_rows: Json; p_table: string }
        Returns: Json
      }
      backup_storage_manifest: {
        Args: { p_after?: string; p_bucket: string; p_limit?: number }
        Returns: Json
      }
      backup_table_pk: { Args: { p_table: string }; Returns: string }
      exec_sql: { Args: { query: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
