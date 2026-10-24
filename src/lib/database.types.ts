
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
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
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
