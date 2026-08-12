import { AdminComment, hideCommentApi, restoreCommentApi, adminDeleteCommentApi } from '../../lib/api';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';

interface CommentsPanelProps {
  comments: AdminComment[];
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}

export function CommentsPanel({ comments, onError, onChanged }: CommentsPanelProps) {
  const handleHide = async (id: string) => {
    try {
      await hideCommentApi(id);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreCommentApi(id);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminDeleteCommentApi(id);
      await onChanged();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <Card className="bg-transparent border-border shadow-2xs p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="pl-6 text-xs">Member ID</TableHead>
            <TableHead className="text-xs">Comment Content</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-right pr-6 text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                No comments found.
              </TableCell>
            </TableRow>
          ) : (
            comments.map((c) => (
              <TableRow key={c.id} className="hover:bg-muted/40 border-border">
                <TableCell className="pl-6 font-mono text-xs text-foreground">
                  <div className="flex flex-col">
                    <span>{c.memberId}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="text-xs text-foreground max-w-md truncate">
                  {c.body}
                </TableCell>

                <TableCell>
                  {c.status === 'hidden' ? (
                    <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                      Hidden
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      Visible
                    </Badge>
                  )}
                </TableCell>

                <TableCell className="text-right pr-6">
                  <div className="flex items-center justify-end gap-1.5">
                    {c.status === 'hidden' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(c.id)}
                        className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleHide(c.id)}
                        className="h-7 text-xs border-border bg-card hover:bg-accent text-foreground"
                      >
                        Hide
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(c.id)}
                      className="h-7 px-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}