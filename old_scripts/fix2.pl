open F,"<:utf8","c.txt"; my @out; my $n=0;
while(<F>){
  s/\x{feff}//g; s/\r//g; next unless /\S/;
  my @p = split;
  my ($tag,$line,$b1,$b2,$x,$side,$fake) = @p[0..6];
  next unless defined $fake;
  my $px = $x * 115.2;
  my $pxs = sprintf("%.3f", $px); $pxs =~ s/0+$//; $pxs =~ s/\.$//; $pxs = "0" if $pxs eq "-0";
  if ($tag eq "n2") { push @out, sprintf("%s %d %.3f %.3f %s %d %d", $tag,$line,$b1,$b2,$pxs,$side,$fake); }
  else              { push @out, sprintf("%s %d %.3f %s %d %d",     $tag,$line,$b1,$pxs,$side,$fake); }
  $n++;
}
print STDERR "notes: $n\n";
print join("\n",@out),"\n";
