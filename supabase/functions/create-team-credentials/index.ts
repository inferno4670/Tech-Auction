// supabase/functions/create-team-credentials/index.ts
// Run with: supabase functions deploy create-team-credentials

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create admin client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { teams } = await req.json();

    if (!Array.isArray(teams) || teams.length === 0) {
      return new Response(
        JSON.stringify({ error: "teams array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = [];
    const errors = [];

    for (const team of teams) {
      try {
        const { team_id, short_name } = team;
        const email = `${short_name.toLowerCase()}@techquiz.com`;

        // Generate a random password: team name + 4 digits
        const digits = Math.floor(1000 + Math.random() * 9000).toString();
        const password = `${short_name.toLowerCase()}${digits}`;

        // Check if auth user already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(
          (u: any) => u.email === email
        );

        let userId: string;

        if (existingUser) {
          // User already exists, use their ID
          userId = existingUser.id;

          // Update their password
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: password,
          });
        } else {
          // Create new auth user
          const { data: newUser, error: createError } =
            await supabaseAdmin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
              user_metadata: {
                role: "team",
                display_name: short_name,
                team_id,
              },
            });

          if (createError) {
            errors.push({ short_name, error: createError.message });
            continue;
          }

          userId = newUser!.user.id;
        }

        // Check if team_members link already exists
        const { data: existingMember } = await supabaseAdmin
          .from("team_members")
          .select("id")
          .eq("user_id", userId)
          .single();

        if (!existingMember) {
          // Create team_members link
          const { error: linkError } = await supabaseAdmin
            .from("team_members")
            .insert({ user_id: userId, team_id });

          if (linkError) {
            errors.push({
              short_name,
              error: `Auth created but link failed: ${linkError.message}`,
            });
            continue;
          }
        }

        results.push({
          team_id,
          short_name,
          email,
          password,
          user_id: userId,
        });
      } catch (err: any) {
        errors.push({ short_name: team.short_name, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        credentials: results,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
