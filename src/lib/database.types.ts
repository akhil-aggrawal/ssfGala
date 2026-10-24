
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "attendees": {
                  Row: {
                    "assigned_table_number": string | null,"cancelled_at": string | null,"created_at": string,"email": string,"event_id": string,"full_name": string,"id": string,"registration_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_table_number"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"email": string,"event_id": string,"full_name": string,"id"?: string,"registration_id": string
                  }
                  Update: {
                    "assigned_table_number"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"email"?: string,"event_id"?: string,"full_name"?: string,"id"?: string,"registration_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendees_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendees_registration_id_event_id_fkey"
      columns: ["registration_id","event_id"]
isOneToOne: false
      referencedRelation: "registrations"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"after_data": Json | null,"before_data": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"event_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"event_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"event_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_logs_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"date_at": string | null,"id": string,"name": string,"status": string,"venue": string | null,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"date_at"?: string | null,"id"?: string,"name": string,"status"?: string,"venue"?: string | null,"year": number
                  }
                  Update: {
                    "created_at"?: string,"date_at"?: string | null,"id"?: string,"name"?: string,"status"?: string,"venue"?: string | null,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"payment_allocations": {
                  Row: {
                    "amount_cents": number,"attendee_id": string,"created_at": string,"event_id": string,"id": string,"payment_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"attendee_id": string,"created_at"?: string,"event_id": string,"id"?: string,"payment_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"attendee_id"?: string,"created_at"?: string,"event_id"?: string,"id"?: string,"payment_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_allocations_attendee_id_event_id_fkey"
      columns: ["attendee_id","event_id"]
isOneToOne: false
      referencedRelation: "attendee_payment_status"
      referencedColumns: ["attendee_id","event_id"]
    },{
      foreignKeyName: "payment_allocations_attendee_id_event_id_fkey"
      columns: ["attendee_id","event_id"]
isOneToOne: false
      referencedRelation: "attendees"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "payment_allocations_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_allocations_payment_id_event_id_fkey"
      columns: ["payment_id","event_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"created_at": string,"event_id": string,"id": string,"provider": string,"purpose": string,"received_at": string | null,"recorded_by": string | null,"registration_id": string | null,"sponsorship_id": string | null,"status": string,"stripe_payment_intent_id": string | null,"stripe_session_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"event_id": string,"id"?: string,"provider": string,"purpose": string,"received_at"?: string | null,"recorded_by"?: string | null,"registration_id"?: string | null,"sponsorship_id"?: string | null,"status": string,"stripe_payment_intent_id"?: string | null,"stripe_session_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"event_id"?: string,"id"?: string,"provider"?: string,"purpose"?: string,"received_at"?: string | null,"recorded_by"?: string | null,"registration_id"?: string | null,"sponsorship_id"?: string | null,"status"?: string,"stripe_payment_intent_id"?: string | null,"stripe_session_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_registration_id_event_id_fkey"
      columns: ["registration_id","event_id"]
isOneToOne: false
      referencedRelation: "registrations"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "payments_sponsorship_id_event_id_fkey"
      columns: ["sponsorship_id","event_id"]
isOneToOne: false
      referencedRelation: "sponsorships"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"email": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string | null,"id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"registrations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"event_id": string,"id": string,"kind": string,"sponsored_table_id": string | null,"status": string,"tier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"event_id": string,"id"?: string,"kind": string,"sponsored_table_id"?: string | null,"status"?: string,"tier_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"event_id"?: string,"id"?: string,"kind"?: string,"sponsored_table_id"?: string | null,"status"?: string,"tier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "registrations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registrations_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registrations_sponsored_table_id_event_id_fkey"
      columns: ["sponsored_table_id","event_id"]
isOneToOne: false
      referencedRelation: "sponsored_tables"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "registrations_tier_id_event_id_fkey"
      columns: ["tier_id","event_id"]
isOneToOne: false
      referencedRelation: "seating_tiers"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"seating_tiers": {
                  Row: {
                    "event_id": string,"id": string,"name": string,"seat_price_cents": number,"sponsorship_amount_cents": number | null,"suggested_contribution_cents": number,"table_inventory": number
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"id"?: string,"name": string,"seat_price_cents": number,"sponsorship_amount_cents"?: number | null,"suggested_contribution_cents": number,"table_inventory"?: number
                  }
                  Update: {
                    "event_id"?: string,"id"?: string,"name"?: string,"seat_price_cents"?: number,"sponsorship_amount_cents"?: number | null,"suggested_contribution_cents"?: number,"table_inventory"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "seating_tiers_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"sponsored_tables": {
                  Row: {
                    "capacity": number,"created_at": string,"event_id": string,"id": string,"invite_token_hash": string,"physical_table_number": string | null,"sponsorship_id": string,"tier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number,"created_at"?: string,"event_id": string,"id"?: string,"invite_token_hash": string,"physical_table_number"?: string | null,"sponsorship_id": string,"tier_id": string
                  }
                  Update: {
                    "capacity"?: number,"created_at"?: string,"event_id"?: string,"id"?: string,"invite_token_hash"?: string,"physical_table_number"?: string | null,"sponsorship_id"?: string,"tier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sponsored_tables_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sponsored_tables_sponsorship_id_event_id_fkey"
      columns: ["sponsorship_id","event_id"]
isOneToOne: false
      referencedRelation: "sponsorships"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "sponsored_tables_tier_id_event_id_fkey"
      columns: ["tier_id","event_id"]
isOneToOne: false
      referencedRelation: "seating_tiers"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"sponsors": {
                  Row: {
                    "created_at": string,"display_name": string,"email": string,"event_id": string,"id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"email": string,"event_id": string,"id"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"email"?: string,"event_id"?: string,"id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sponsors_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sponsors_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"sponsorships": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"pledged_cents": number,"sponsor_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"pledged_cents": number,"sponsor_id": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"pledged_cents"?: number,"sponsor_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sponsorships_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sponsorships_sponsor_id_event_id_fkey"
      columns: ["sponsor_id","event_id"]
isOneToOne: false
      referencedRelation: "sponsors"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"stripe_webhook_events": {
                  Row: {
                    "event_id": string,"processed_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"processed_at"?: string
                  }
                  Update: {
                    "event_id"?: string,"processed_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_roles": {
                  Row: {
                    "role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "role": string,"user_id": string
                  }
                  Update: {
                    "role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "attendee_payment_status": {
                  Row: {
                    "attendee_id": string,"event_id": string,"paid": boolean | null,"registration_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "attendee_id"?: string | null,"event_id"?: string | null,"paid"?: never,"registration_id"?: string | null
                         }
                        Update: {
                           "attendee_id"?: string | null,"event_id"?: string | null,"paid"?: never,"registration_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "attendees_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendees_registration_id_event_id_fkey"
      columns: ["registration_id","event_id"]
isOneToOne: false
      referencedRelation: "registrations"
      referencedColumns: ["id","event_id"]
    }
                  ]
                }
          }
          Functions: {
            "add_admin_attendees":
{ Args: { "p_actor_id": string,"p_amount_cents"?: number,"p_attendees": Json,"p_event_id": string,"p_kind": string,"p_tier_id": string }; Returns: string
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"pledge_sponsorship":
{ Args: { "p_display_name": string,"p_email": string,"p_event_id": string,"p_tables": Json,"p_token_hashes": string[],"p_user_id": string }; Returns: Json
                           },
"record_audit_log":
{ Args: { "p_action": string,"p_actor_id": string,"p_after_data": Json,"p_before_data": Json,"p_entity_id": string,"p_entity_type": string,"p_event_id": string }; Returns: number
                           },
"save_gala_setup":
{ Args: { "p_actor_id": string,"p_event": Json,"p_event_id"?: string,"p_tiers": Json }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
