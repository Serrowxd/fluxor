"use client"

import type { ReactNode } from "react"
import Sidebar from "./sidebar"
import TopNav from "./top-nav"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { ChatTrigger } from "@/components/chat/ChatTrigger"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { ChatInput } from "@/components/chat/ChatInput"
import { ConversationView } from "@/components/chat/ConversationView"
import { useChat } from "@/hooks/useChat"

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const { messages, sendMessage, isSending } = useChat()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div className={`flex h-screen ${theme === "dark" ? "dark" : ""}`}>
      <Sidebar />
      <div className="w-full flex flex-1 flex-col">
        <header className="h-16 border-b border-gray-200 dark:border-[#1F1F23]">
          <TopNav />
        </header>
        <main className="flex-1 overflow-auto">
          <div className="p-6 bg-white dark:bg-[#0F0F12]">
            {children}
          </div>
        </main>
      </div>
      
      {/* Chat Components */}
      <ChatTrigger onClick={() => setIsChatOpen(true)} />
      <ChatPanel 
        isOpen={isChatOpen} 
        onOpenChange={setIsChatOpen}
        inputComponent={
          <ChatInput 
            onSendMessage={sendMessage}
            disabled={isSending}
            placeholder="Ask about inventory, sales, or trends..."
          />
        }
      >
        <ConversationView 
          messages={messages}
          isTyping={isSending}
          className="h-full"
        />
      </ChatPanel>
    </div>
  )
}
