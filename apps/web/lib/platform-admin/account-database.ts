import type { Database, Json } from "@site-chat/shared";
export type AccountDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      platform_admin_list_accounts: {
        Args: { p_actor_id: string; p_query: string; p_page: number };
        Returns: Json;
      };
      platform_admin_delete_account: {
        Args: {
          p_actor_id: string;
          p_user_id: string;
          p_expected_email: string;
          p_reason: string;
        };
        Returns: undefined;
      };
    };
  };
};
